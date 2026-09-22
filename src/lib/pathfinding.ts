export type Point2D = { x: number; y: number };

// Represents a node in the A* grid
class Node {
  x: number;
  y: number;
  g: number = 0; // Cost from start
  h: number = 0; // Heuristic cost to end
  f: number = 0; // Total cost (g + h)
  parent: Node | null = null;
  walkable: boolean;

  constructor(x: number, y: number, walkable: boolean) {
    this.x = x;
    this.y = y;
    this.walkable = walkable;
  }
}

// Manhattan distance heuristic
const heuristic = (a: Node, b: Node) => {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
};

export const findPathAStar = (
  gridSize: number, // e.g., 40 for a 40x40 grid
  obstacles: Point2D[], // Array of obstacle grid coordinates
  startCoord: Point2D,
  endCoord: Point2D
): Point2D[] | null => {
  // 1. Initialize grid
  const grid: Node[][] = [];
  for (let x = 0; x < gridSize; x++) {
    grid[x] = [];
    for (let y = 0; y < gridSize; y++) {
      grid[x][y] = new Node(x, y, true);
    }
  }

  // 2. Mark obstacles (with safety buffer dilation)
  // Dilation radius = 1 cell (0.5m)
  obstacles.forEach(obs => {
    const rx = Math.round(obs.x);
    const ry = Math.round(obs.y);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const nx = rx + dx;
        const ny = ry + dy;
        if (nx >= 0 && nx < gridSize && ny >= 0 && ny < gridSize) {
          grid[nx][ny].walkable = false;
        }
      }
    }
  });

  const sx = Math.max(0, Math.min(gridSize - 1, Math.round(startCoord.x)));
  const sy = Math.max(0, Math.min(gridSize - 1, Math.round(startCoord.y)));
  const ex = Math.max(0, Math.min(gridSize - 1, Math.round(endCoord.x)));
  const ey = Math.max(0, Math.min(gridSize - 1, Math.round(endCoord.y)));

  const startNode = grid[sx][sy];
  const endNode = grid[ex][ey];

  // If start or end is blocked (or dilated), forcibly make start walkable
  // If end is blocked, we will just fail to find a path, which is correct
  startNode.walkable = true;

  const openSet: Node[] = [startNode];
  const closedSet: Set<string> = new Set();

  while (openSet.length > 0) {
    // Get node with lowest f score
    let lowestIndex = 0;
    for (let i = 0; i < openSet.length; i++) {
      if (openSet[i].f < openSet[lowestIndex].f) {
        lowestIndex = i;
      }
    }
    const current = openSet[lowestIndex];

    // Found path
    if (current === endNode) {
      const path: Point2D[] = [];
      let temp: Node | null = current;
      while (temp) {
        path.push({ x: temp.x, y: temp.y });
        temp = temp.parent;
      }
      return path.reverse(); // from start to end
    }

    // Move current from open to closed
    openSet.splice(lowestIndex, 1);
    closedSet.add(`${current.x},${current.y}`);

    // Check neighbors (8 directions)
    const neighbors = [
      { x: 0, y: -1 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: -1, y: 0 },
      { x: 1, y: -1 }, { x: 1, y: 1 }, { x: -1, y: 1 }, { x: -1, y: -1 }
    ];

    for (const n of neighbors) {
      const nx = current.x + n.x;
      const ny = current.y + n.y;

      if (nx >= 0 && nx < gridSize && ny >= 0 && ny < gridSize) {
        const neighbor = grid[nx][ny];

        if (!closedSet.has(`${nx},${ny}`) && neighbor.walkable) {
          // Cost is 1 for straight, 1.414 for diagonal
          const moveCost = (n.x !== 0 && n.y !== 0) ? 1.414 : 1;
          const tempG = current.g + moveCost;

          let newPath = false;
          if (openSet.includes(neighbor)) {
            if (tempG < neighbor.g) {
              neighbor.g = tempG;
              newPath = true;
            }
          } else {
            neighbor.g = tempG;
            newPath = true;
            openSet.push(neighbor);
          }

          if (newPath) {
            neighbor.h = heuristic(neighbor, endNode);
            neighbor.f = neighbor.g + neighbor.h;
            neighbor.parent = current;
          }
        }
      }
    }
  }

  // No path found
  return null;
}
