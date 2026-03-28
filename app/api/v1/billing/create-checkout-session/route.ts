import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';
import { validateApiKey } from '@/lib/auth';

export async function POST(req: NextRequest) {
  const auth = await validateApiKey(req);
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { plan } = await req.json();

  if (!plan || !['pro', 'business'].includes(plan)) {
    return NextResponse.json(
      { error: 'plan must be "pro" or "business"' },
      { status: 400 }
    );
  }

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
    apiVersion: '2026-03-25.dahlia' as any,
  });

  const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  // Get user's stripe customer ID
  const { data: user } = await supabaseAdmin
    .from('users')
    .select('stripe_customer_id, email')
    .eq('id', auth.userId)
    .single();

  if (!user?.stripe_customer_id) {
    return NextResponse.json(
      { error: 'No billing account found. Please contact support.' },
      { status: 400 }
    );
  }

  const priceId = plan === 'pro'
    ? process.env.STRIPE_PRO_PRICE_ID!
    : process.env.STRIPE_BUSINESS_PRICE_ID!;

  const session = await stripe.checkout.sessions.create({
    customer: user.stripe_customer_id,
    mode: 'subscription',
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: 'https://app.veclabs.xyz/usage?upgraded=true',
    cancel_url: 'https://app.veclabs.xyz/pricing?cancelled=true',
    allow_promotion_codes: true,
  });

  return NextResponse.json({ url: session.url });
}
