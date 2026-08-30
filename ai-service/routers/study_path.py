"""
StudyForge — Study Path API

Exposes the A* study-path algorithm through the AI microservice.
"""

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from core.auth import verify_service_key
from services.study_path import a_star


router = APIRouter(
    prefix="/study-path",
    tags=["study-path"],
)


class StudyPathRequest(BaseModel):
    start: str = Field(
        ...,
        min_length=1,
        description="Starting study topic",
    )

    goal: str = Field(
        ...,
        min_length=1,
        description="Target study topic",
    )

    graph: dict[
        str,
        list[tuple[str, float]]
    ]

    positions: dict[
        str,
        tuple[float, float]
    ] = {}


class StudyPathResponse(BaseModel):
    path: list[str]

    cost: float | None

    algorithm: str

    nodes_explored: int

    message: str | None = None


@router.post(
    "",
    response_model=StudyPathResponse,
)
async def generate_study_path(
    body: StudyPathRequest,
    _: bool = Depends(verify_service_key),
):
    """
    Run A* search over the supplied study graph.
    """

    return a_star(
        graph=body.graph,
        start=body.start,
        goal=body.goal,
        positions=body.positions,
    )