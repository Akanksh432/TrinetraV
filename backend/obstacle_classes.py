"""
Semantic cost model for detected obstacle/hazard classes.

Every obstacle emitted by DualPerceptionEngine carries a 'label'. This table
maps that label to a (avoid_radius_m, risk_weight) pair that the planners
(A* dilation on the frontend, DWA cost function) use so that path planning
treats a person differently from a static rock. This is intentionally a
single shared source of truth so backend perception and frontend planning
never disagree on how dangerous a class is.

avoid_radius_m: minimum clearance (meters) the rover should keep from the
                object's projected ground point.
risk_weight:    multiplier applied to planner cost when a candidate path/
                trajectory passes within avoid_radius_m of this object.
                Higher = planner works harder to route around it.
is_dynamic:     hint to the planner that this object may move between
                frames (so DWA should re-check it every cycle rather than
                treating it as a fixed occupancy cell).
"""

from typing import Dict, TypedDict


class ClassProfile(TypedDict):
    avoid_radius_m: float
    risk_weight: float
    is_dynamic: bool


DEFAULT_PROFILE: ClassProfile = {
    "avoid_radius_m": 0.35,
    "risk_weight": 1.0,
    "is_dynamic": False,
}

# COCO/YOLO classes we actually expect in an outdoor field-robotics context,
# plus our own terrain-hazard segmenter outputs (see perception.py).
OBSTACLE_CLASS_PROFILES: Dict[str, ClassProfile] = {
    # People and animals: highest priority, assume they can move unpredictably.
    "person":       {"avoid_radius_m": 1.20, "risk_weight": 5.0, "is_dynamic": True},
    "dog":          {"avoid_radius_m": 0.80, "risk_weight": 3.0, "is_dynamic": True},
    "cat":          {"avoid_radius_m": 0.60, "risk_weight": 2.5, "is_dynamic": True},
    "horse":        {"avoid_radius_m": 1.50, "risk_weight": 4.0, "is_dynamic": True},
    "cow":          {"avoid_radius_m": 1.50, "risk_weight": 3.5, "is_dynamic": True},

    # Vehicles: large, potentially moving, expensive to hit.
    "car":          {"avoid_radius_m": 1.50, "risk_weight": 4.0, "is_dynamic": True},
    "truck":        {"avoid_radius_m": 2.00, "risk_weight": 4.5, "is_dynamic": True},
    "bicycle":      {"avoid_radius_m": 0.90, "risk_weight": 3.0, "is_dynamic": True},
    "motorcycle":   {"avoid_radius_m": 1.00, "risk_weight": 3.5, "is_dynamic": True},

    # Static structural obstacles.
    "bench":        {"avoid_radius_m": 0.50, "risk_weight": 2.0, "is_dynamic": False},
    "fire hydrant": {"avoid_radius_m": 0.40, "risk_weight": 2.0, "is_dynamic": False},
    "potted plant": {"avoid_radius_m": 0.40, "risk_weight": 1.5, "is_dynamic": False},

    # Our own terrain-hazard segmenter outputs (see perception.py).
    "rock/obstacle":  {"avoid_radius_m": 0.35, "risk_weight": 2.5, "is_dynamic": False},
    "ditch/hole":     {"avoid_radius_m": 0.50, "risk_weight": 4.0, "is_dynamic": False},
    "loose_terrain":  {"avoid_radius_m": 0.25, "risk_weight": 1.2, "is_dynamic": False},
}


def get_profile(label: str) -> ClassProfile:
    return OBSTACLE_CLASS_PROFILES.get(label, DEFAULT_PROFILE)
