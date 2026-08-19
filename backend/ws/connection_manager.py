import json
from typing import Any, Dict, List

from fastapi import WebSocket
from starlette.websockets import WebSocketDisconnect


class ConnectionManager:
    def __init__(self) -> None:
        self.active_connections: List[WebSocket] = []

    async def connect(self, websocket: WebSocket) -> None:
        await websocket.accept()
        self.active_connections.append(websocket)

    def disconnect(self, websocket: WebSocket) -> None:
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)

    async def send_json(
        self, websocket: WebSocket, message: Dict[str, Any]
    ) -> None:
        try:
            await websocket.send_text(json.dumps(message))
        except (WebSocketDisconnect, RuntimeError):
            self.disconnect(websocket)

    async def broadcast_json(self, message: Dict[str, Any]) -> None:
        dead: List[WebSocket] = []
        for connection in self.active_connections:
            try:
                await connection.send_text(json.dumps(message))
            except (WebSocketDisconnect, RuntimeError):
                dead.append(connection)
        for connection in dead:
            self.disconnect(connection)
