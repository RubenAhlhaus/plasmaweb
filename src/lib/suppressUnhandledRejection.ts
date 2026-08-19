/** Attach a catch so async work is not floating; log unexpected rejections. */
export function suppressUnhandledRejection(
  promise: Promise<unknown>,
  context: string,
): void {
  promise.catch((error: unknown) => {
    console.error(context, error);
  });
}
