import { getStore } from '@netlify/blobs';
export default async (req) => {
  const code = process.env.ACCESS_CODE;
  if (code && req.headers.get('x-access-code') !== code) return Response.json({ error: 'Access code required.' }, { status: 401 });
  const { id } = await req.json();
  if (!/^[\w-]{8,64}$/.test(String(id))) return Response.json({ error: 'Bad id.' }, { status: 400 });
  const v = await getStore({ name: 'jobs', consistency: 'strong' }).get(id, { type: 'json' });
  return Response.json(v || { status: 'pending' });
};
