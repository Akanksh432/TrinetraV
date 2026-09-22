"""
Self-supervised free-space / terrain-hazard segmentation.

Replaces the old single-threshold "adaptive contrast" hack. This module
follows the classic field-robotics trick used on cameras without stereo or
lidar (e.g. LAGR-style ground classifiers): assume the small patch of ground
directly in front of the rover is traversable (the rover just drove onto the
edge of it or is about to), build an appearance model (color + texture) of
that patch, then segment the rest of the visible ground corridor into
SLIC superpixels and flag any superpixel that looks statistically different
from the "known safe" anchor patch as a hazard.

This is a real, deterministic CV algorithm (not a placeholder threshold) and
needs no training data or labeled dataset, which matters given we don't have
a terrain dataset for this rover yet. It should be swapped for a trained
segmentation network (Fast-SCNN/BiSeNet on a real terrain dataset) once
enough field footage has been collected -- the interface (`segment`) is
designed so that swap doesn't touch perception.py or main.py.
"""

from typing import List, Tuple, TypedDict

import cv2
import numpy as np
from skimage.segmentation import slic
from skimage.measure import regionprops


class Hazard(TypedDict):
    label: str          # 'rock/obstacle' | 'ditch/hole' | 'loose_terrain'
    bbox: List[int]      # [x1, y1, x2, y2] in the frame this was computed on
    conf: float


class TerrainSegmenter:
    def __init__(
        self,
        n_segments: int = 120,
        compactness: float = 12.0,
        anomaly_z_threshold: float = 2.2,
        min_area_px: int = 60,
        max_area_px: int = 20000,
    ):
        self.n_segments = n_segments
        self.compactness = compactness
        self.anomaly_z_threshold = anomaly_z_threshold
        self.min_area_px = min_area_px
        self.max_area_px = max_area_px

    def segment(
        self, frame_bgr: np.ndarray, corridor_mask: np.ndarray, anchor_rect: Tuple[int, int, int, int]
    ) -> List[Hazard]:
        """
        frame_bgr:     the (already downscaled) inference frame.
        corridor_mask: uint8 mask (0/255) of the ground corridor to search within.
        anchor_rect:   (x1, y1, x2, y2) of a patch assumed traversable
                       (e.g. the strip of ground closest to the rover).
        """
        h, w = frame_bgr.shape[:2]
        lab = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2LAB)
        gray = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2GRAY)

        # Texture channel: local Laplacian energy highlights rocks/ditches
        # (high-frequency edges) vs. smooth dirt/grass.
        texture = cv2.convertScaleAbs(cv2.Laplacian(gray, cv2.CV_16S, ksize=3))

        # Superpixels only need to be computed over the corridor, but SLIC
        # wants a full image; we mask out-of-corridor pixels afterward.
        segments = slic(
            cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2RGB),
            n_segments=self.n_segments,
            compactness=self.compactness,
            start_label=1,
        )

        ax1, ay1, ax2, ay2 = anchor_rect
        anchor_ids = np.unique(segments[ay1:ay2, ax1:ax2])
        if len(anchor_ids) == 0:
            return []

        # Build the "known safe ground" appearance model from the anchor patch.
        anchor_pixel_mask = np.isin(segments, anchor_ids)
        anchor_lab = lab[anchor_pixel_mask]
        anchor_tex = texture[anchor_pixel_mask]
        if anchor_lab.size == 0:
            return []
        mu = anchor_lab.reshape(-1, 3).mean(axis=0)
        sigma = anchor_lab.reshape(-1, 3).std(axis=0) + 1e-3
        tex_mu = float(anchor_tex.mean())
        tex_sigma = float(anchor_tex.std()) + 1e-3

        hazard_mask = np.zeros((h, w), dtype=np.uint8)
        props = regionprops(segments)

        for region in props:
            sp_id = region.label
            if sp_id in anchor_ids:
                continue
            ys, xs = np.where(segments == sp_id)
            if ys.size == 0:
                continue
            # Only consider superpixels that fall (mostly) inside the ground corridor.
            in_corridor = corridor_mask[ys, xs] > 0
            if in_corridor.mean() < 0.6:
                continue

            sp_lab = lab[ys, xs].reshape(-1, 3).astype(np.float32)
            sp_tex = float(texture[ys, xs].mean())

            # Mahalanobis-style z-distance (diagonal covariance) from the
            # anchor "safe ground" appearance model, combined with a texture
            # z-score. Either channel spiking flags an anomaly.
            color_z = np.linalg.norm((sp_lab.mean(axis=0) - mu) / sigma)
            tex_z = abs(sp_tex - tex_mu) / tex_sigma
            score = max(color_z, tex_z)

            if score > self.anomaly_z_threshold:
                hazard_mask[ys, xs] = 255

        kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (5, 5))
        hazard_mask = cv2.morphologyEx(hazard_mask, cv2.MORPH_CLOSE, kernel)
        hazard_mask = cv2.bitwise_and(hazard_mask, hazard_mask, mask=corridor_mask)

        contours, _ = cv2.findContours(hazard_mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

        results: List[Hazard] = []
        for cnt in contours:
            area = cv2.contourArea(cnt)
            if not (self.min_area_px < area < self.max_area_px):
                continue
            rx, ry, rw, rh = cv2.boundingRect(cnt)

            # Classify the hazard: darker-than-ground + low texture -> likely
            # a ditch/hole (shadowed depression); high texture -> a rock/
            # rubble pile; everything else -> minor loose terrain.
            patch_gray_mean = float(gray[ry:ry + rh, rx:rx + rw].mean())
            patch_tex_mean = float(texture[ry:ry + rh, rx:rx + rw].mean())
            anchor_gray_mean = float(gray[ay1:ay2, ax1:ax2].mean())

            if patch_gray_mean < anchor_gray_mean - 15 and patch_tex_mean < tex_mu:
                label = "ditch/hole"
            elif patch_tex_mean > tex_mu + tex_sigma:
                label = "rock/obstacle"
            else:
                label = "loose_terrain"

            conf = float(np.clip(0.5 + (area / self.max_area_px), 0.5, 0.95))
            results.append({
                "label": label,
                "bbox": [rx, ry, rx + rw, ry + rh],
                "conf": round(conf, 2),
            })

        return results
