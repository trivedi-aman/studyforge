"""
StudyForge — A* Study Path Service

A classical AI search algorithm used to find an optimal
learning path between two study topics.

Each topic is represented as a graph node.

Each edge contains:
    - destination topic
    - learning cost

A* evaluates nodes using:

    f(n) = g(n) + h(n)

where:

    g(n) = cost accumulated so far
    h(n) = estimated remaining cost
    f(n) = total estimated cost
"""

from heapq import heappush, heappop
from math import inf


def heuristic(
    current: str,
    goal: str,
    positions: dict[str, tuple[float, float]],
) -> float:
    """
    Calculate the heuristic distance between two topics.

    We use Euclidean distance for the initial implementation.

    If a topic has no position, h(n) = 0.
    """

    if current not in positions or goal not in positions:
        return 0.0

    x1, y1 = positions[current]
    x2, y2 = positions[goal]

    return ((x1 - x2) ** 2 + (y1 - y2) ** 2) ** 0.5


def reconstruct_path(
    came_from: dict[str, str],
    current: str,
) -> list[str]:
    """
    Reconstruct the final path after reaching the goal.
    """

    path = [current]

    while current in came_from:
        current = came_from[current]
        path.append(current)

    path.reverse()

    return path


def a_star(
    graph: dict[str, list[tuple[str, float]]],
    start: str,
    goal: str,
    positions: dict[str, tuple[float, float]] | None = None,
) -> dict:
    """
    Find the lowest-cost path from start to goal using A*.

    Example graph:

        {
            "Probability": [
                ("Random Variables", 1)
            ],

            "Random Variables": [
                ("Probability Distributions", 1)
            ]
        }

    Returns:

        {
            "path": [...],
            "cost": 5.0,
            "algorithm": "A*"
        }
    """

    if positions is None:
        positions = {}

    # Validate start
    if start not in graph:
        raise ValueError(
            f"Start topic '{start}' does not exist in the study graph."
        )

    # Validate goal
    if goal not in graph:
        raise ValueError(
            f"Goal topic '{goal}' does not exist in the study graph."
        )

    # Priority queue:
    #
    # (f_score, counter, node)
    #
    # The counter prevents Python from comparing
    # topic strings when two f_scores are equal.
    open_set = []

    counter = 0

    start_g = 0.0

    start_h = heuristic(
        start,
        goal,
        positions,
    )

    start_f = start_g + start_h

    heappush(
        open_set,
        (
            start_f,
            counter,
            start,
        ),
    )

    # Stores the previous node in the optimal path.
    came_from: dict[str, str] = {}

    # g(n): cheapest known cost from start → n
    g_score = {
        node: inf
        for node in graph
    }

    g_score[start] = 0.0

    # Nodes already processed.
    closed_set: set[str] = set()

    nodes_explored = 0

    while open_set:

        _, _, current = heappop(open_set)

        # Ignore duplicate queue entries.
        if current in closed_set:
            continue

        nodes_explored += 1

        # Goal reached.
        if current == goal:

            path = reconstruct_path(
                came_from,
                current,
            )

            return {
                "path": path,
                "cost": g_score[current],
                "algorithm": "A*",
                "nodes_explored": nodes_explored,
                "message": None,
            }

        closed_set.add(current)

        # Explore neighboring topics.
        for neighbor, edge_cost in graph.get(current, []):

            # A* requires non-negative edge costs.
            if edge_cost < 0:
                raise ValueError(
                    "A* requires non-negative edge costs."
                )

            if neighbor in closed_set:
                continue

            # Calculate tentative g(n).
            tentative_g = (
                g_score[current]
                + edge_cost
            )

            # Found a cheaper path to this neighbor.
            if tentative_g < g_score.get(
                neighbor,
                inf,
            ):

                came_from[neighbor] = current

                g_score[neighbor] = tentative_g

                h_score = heuristic(
                    neighbor,
                    goal,
                    positions,
                )

                f_score = (
                    tentative_g
                    + h_score
                )

                counter += 1

                heappush(
                    open_set,
                    (
                        f_score,
                        counter,
                        neighbor,
                    ),
                )

    # No path exists.
    return {
        "path": [],
        "cost": None,
        "algorithm": "A*",
        "nodes_explored": nodes_explored,
        "message": (
            "No learning path exists between "
            "the selected topics."
        ),
    }