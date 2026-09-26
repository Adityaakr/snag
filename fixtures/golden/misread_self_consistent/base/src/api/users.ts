const users = new Map<string, { name: string }>();

export function getUser(id: string) {
  const user = users.get(id);
  return { status: 200, body: user };
}
