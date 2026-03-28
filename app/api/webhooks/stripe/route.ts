import { NextRequest, NextResponse } from 'next/server';
import { stripe } from '@/lib/stripe';
import { supabaseAdmin } from '@/lib/supabase';

export async function POST(req: NextRequest) {
  const body = await req.text();
  const sig = req.headers.get('stripe-signature')!;

  let event;
  try {
    event = stripe.webhooks.constructEvent(body, sig, process.env.STRIPE_WEBHOOK_SECRET!);
  } catch {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
  }

  const session = event.data.object as Record<string, any>;

  switch (event.type) {
    case 'customer.subscription.updated':
    case 'customer.subscription.created': {
      const plan = session.items.data[0].price.id === process.env.STRIPE_PRO_PRICE_ID
        ? 'pro' : 'free';

      await supabaseAdmin
        .from('users')
        .update({ plan, subscription_status: session.status })
        .eq('stripe_customer_id', session.customer);
      break;
    }
    case 'customer.subscription.deleted': {
      await supabaseAdmin
        .from('users')
        .update({ plan: 'free', subscription_status: 'cancelled' })
        .eq('stripe_customer_id', session.customer);
      break;
    }
  }

  return NextResponse.json({ received: true });
}
