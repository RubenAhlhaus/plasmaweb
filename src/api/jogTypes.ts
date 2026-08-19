export type JogAxis = 'x' | 'y' | 'z';

type JogDirection = 'positive' | 'negative';

export interface UiJogRequest {
  axis: JogAxis;
  direction: JogDirection;
}

