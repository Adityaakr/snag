export async function upload(send: () => Promise<void>) {
  await send();
}
