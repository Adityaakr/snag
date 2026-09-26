const users = new Map<string, { name: string }>();

export function getUser(id: string) {
  const user = users.get(id);
  if (!user) {
    return { status: 400, body: { error: 'unknown id' } };
  }
  return { status: 200, body: user };
}
