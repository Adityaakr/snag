export async function upload(send: () => Promise<void>) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await send();
    } catch (e) {
      if (attempt >= 3) throw e;
    }
  }
}
