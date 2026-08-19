/** Achsenwahl im Homing-Dialog (mappt auf `joint` fürs Backend). */
export type HomingAxis = 'all' | 'x' | 'y' | 'z';

export type HomingAction = 'home' | 'unhome';

/** Callback vom Homing-Dialog; zweites Argument defaultet in `useHomingCommands` zu `home`. */
export type HomingSelectHandler = (axis: HomingAxis, action?: HomingAction) => void;
