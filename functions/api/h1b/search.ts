import { getPrisma, type Env } from '../../_lib/prisma';
import { jsonResponse, safeHandler } from '../../_lib/currentUser';

interface PagesContext {
  request: Request;
  env: Env;
}

export const onRequestGet = safeHandler<PagesContext>(async ({ request, env }: PagesContext) => {
  const url = new URL(request.url);
  const q = (url.searchParams.get('q') || '').trim();
  const limitParam = parseInt(url.searchParams.get('limit') || '50', 10);
  const limit = Math.min(Math.max(1, isNaN(limitParam) ? 50 : limitParam), 100);

  if (!q || q.length < 2) {
    return jsonResponse({ data: [], total: 0 });
  }

  const prisma = getPrisma(env);
  const employers = await (prisma as any).lcaEmployer.findMany({
    where: {
      OR: [
        { employerName: { contains: q, mode: 'insensitive' } },
        { slug: { contains: q.toLowerCase().replace(/[^a-z0-9]+/g, '-'), mode: 'insensitive' } },
      ],
    },
    orderBy: { totalLCAs: 'desc' },
    take: limit,
  });

  return jsonResponse({ data: employers, total: employers.length });
});
