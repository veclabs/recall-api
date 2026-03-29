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

  const priceId = plan === 'pro'
    ? process.env.STRIPE_PRO_PRICE_ID!
    : process.env.STRIPE_BUSINESS_PRICE_ID!;

  let stripeCustomerId = user?.stripe_customer_id;

  // If no customer ID or customer doesn't exist in current Stripe mode,
  // create a new one
  if (!stripeCustomerId) {
    const newCustomer = await stripe.customers.create({
      email: user?.email ?? '',
      metadata: { supabase_id: auth.userId },
    });
    stripeCustomerId = newCustomer.id;

    // Save new customer ID back to Supabase
    await supabaseAdmin
      .from('users')
      .update({ stripe_customer_id: stripeCustomerId })
      .eq('id', auth.userId);
  }

  // Wrap the checkout session creation to handle stale customer IDs
  let session;
  try {
    session = await stripe.checkout.sessions.create({
      customer: stripeCustomerId,
      mode: 'subscription',
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: 'https://app.veclabs.xyz/usage?upgraded=true',
      cancel_url: 'https://app.veclabs.xyz/pricing?cancelled=true',
      allow_promotion_codes: true,
    });
  } catch (stripeErr: any) {
    // Customer exists in DB but not in this Stripe mode — create fresh
    if (stripeErr.code === 'resource_missing') {
      const newCustomer = await stripe.customers.create({
        email: user?.email ?? '',
        metadata: { supabase_id: auth.userId },
      });
      stripeCustomerId = newCustomer.id;

      await supabaseAdmin
        .from('users')
        .update({ stripe_customer_id: stripeCustomerId })
        .eq('id', auth.userId);

      session = await stripe.checkout.sessions.create({
        customer: stripeCustomerId,
        mode: 'subscription',
        line_items: [{ price: priceId, quantity: 1 }],
        success_url: 'https://app.veclabs.xyz/usage?upgraded=true',
        cancel_url: 'https://app.veclabs.xyz/pricing?cancelled=true',
        allow_promotion_codes: true,
      });
    } else {
      throw stripeErr;
    }
  }

  return NextResponse.json({ url: session.url });
}
