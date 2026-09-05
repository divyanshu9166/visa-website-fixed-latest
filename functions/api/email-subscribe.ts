import { getPrisma, type Env } from '../_lib/prisma';
import { jsonResponse, safeHandler } from '../_lib/currentUser';

interface PagesContext {
  request: Request;
  env: Env;
}

export const onRequestPost = safeHandler<PagesContext>(async ({ request, env }: PagesContext) => {
  const body = await request.json() as {
    email?: string;
    alertType?: string;
    metadata?: Record<string, string>;
  };

  const { email, alertType, metadata } = body;

  if (!email || !alertType) {
    return jsonResponse({ error: 'email and alertType are required.' }, { status: 400 });
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return jsonResponse({ error: 'Invalid email address.' }, { status: 400 });
  }

  const validTypes = ['visa_bulletin', 'slot_alert', 'newsletter'];
  if (!validTypes.includes(alertType)) {
    return jsonResponse({ error: 'Invalid alertType.' }, { status: 400 });
  }

  const prisma = getPrisma(env);

  const existing = await (prisma as any).emailSubscription.findFirst({
    where: { email, alertType },
  });

  if (existing) {
    return jsonResponse({ success: true, message: 'Already subscribed.', alreadyExisted: true });
  }

  const sub = await (prisma as any).emailSubscription.create({
    data: {
      email,
      alertType,
      metadata: metadata ? JSON.stringify(metadata) : null,
    },
  });

  // Send email via Resend
  if (env.RESEND_API_KEY) {
    try {
      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${env.RESEND_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          from: 'EasyVisaCheck <notifications@easyvisacheck.com>',
          to: email,
          subject: 'Confirm your subscription to EasyVisaCheck',
          html: `<p>Thank you for subscribing to ${alertType} alerts!</p><p>Please <a href="https://easyvisacheck.com/confirm?token=${sub.token}">click here</a> to confirm your subscription.</p>`
        })
      });
    } catch (e) {
      console.error('Failed to send confirmation email', e);
    }
  }

  return jsonResponse({ success: true, id: sub.id, message: 'Subscribed! Check your email to confirm.' });
});

export const onRequestDelete = safeHandler<PagesContext>(async ({ request, env }: PagesContext) => {
  const url = new URL(request.url);
  const token = url.searchParams.get('token');
  if (!token) return jsonResponse({ error: 'token is required.' }, { status: 400 });

  const prisma = getPrisma(env);
  const sub = await (prisma as any).emailSubscription.findUnique({ where: { token } });
  if (!sub) return jsonResponse({ error: 'Subscription not found.' }, { status: 404 });

  await (prisma as any).emailSubscription.delete({ where: { token } });
  return jsonResponse({ success: true, message: 'Unsubscribed successfully.' });
});
