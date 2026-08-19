export class MockWebSocket {
  public readyState = WebSocket.OPEN;
  public sentMessages: string[] = [];

  close() {
    return undefined;
  }

  send(data: string) {
    this.sentMessages.push(data);
  }
}
