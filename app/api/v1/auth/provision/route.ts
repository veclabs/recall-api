import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import Stripe from 'stripe';
import { generateApiKey } from '@/lib/keys';
import { getOrCreateUserWallet } from '@/lib/wallet';
import { Resend } from 'resend';

export async function POST(req: NextRequest) {
  console.log('PROVISION START');

  try {
    const supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
      apiVersion: '2026-03-25.dahlia' as any,
    });

    const authHeader = req.headers.get('authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const jwt = authHeader.replace('Bearer ', '').trim();
    const { data: { user }, error: userError } = await supabaseAdmin.auth.getUser(jwt);
    if (userError || !user) {
      return NextResponse.json({ error: 'Invalid token' }, { status: 401 });
    }

    // Check if already provisioned
    const { data: existingKeys } = await supabaseAdmin
      .from('api_keys')
      .select('id')
      .eq('user_id', user.id)
      .eq('revoked', false);

    if (existingKeys && existingKeys.length > 0) {
      return NextResponse.json({ message: 'Already provisioned' }, { status: 200 });
    }

    const { data: existingUser } = await supabaseAdmin
      .from('users')
      .select('*')
      .eq('id', user.id)
      .single();

    // Stripe customer
    let stripeCustomerId = existingUser?.stripe_customer_id;
    if (!stripeCustomerId) {
      const customer = await stripe.customers.create({
        email: user.email!,
        metadata: { supabase_id: user.id },
      });
      stripeCustomerId = customer.id;

      try {
        await stripe.subscriptions.create({
          customer: stripeCustomerId,
          items: [{ price: process.env.STRIPE_FREE_TIER_PRICE_ID }],
        });
      } catch (stripeErr) {
        console.warn('Stripe free subscription failed:', stripeErr);
      }
    }

    // Upsert users row — wallet columns will be populated by getOrCreateUserWallet below
    await supabaseAdmin.from('users').upsert({
      id: user.id,
      email: user.email!,
      full_name: user.user_metadata?.full_name ?? user.user_metadata?.name ?? null,
      stripe_customer_id: stripeCustomerId,
      plan: 'free',
    }, { onConflict: 'id' });

    // Generate Solana wallet for this user — encrypted keypair stored in Supabase
    // This is the key used to encrypt their vectors in Shadow Drive
    try {
      const wallet = await getOrCreateUserWallet(user.id);
      console.log(`[provision] wallet created for ${user.id}: ${wallet.publicKey.toString()}`);
    } catch (walletErr) {
      // Log but don't fail provision — wallet can be created on first write
      console.error('[provision] wallet creation failed:', walletErr);
    }

    // Generate first API key
    const { key, hash, prefix } = generateApiKey();
    await supabaseAdmin.from('api_keys').insert({
      user_id: user.id,
      key_hash: hash,
      key_prefix: prefix,
      name: 'Default',
    });

    // Welcome email
    try {
      const resend = new Resend(process.env.RESEND_API_KEY);
      await resend.emails.send({
        from: 'Recall <hello@veclabs.xyz>',
        to: user.email!,
        subject: 'Your Recall API key',
        html: `
          <p>Welcome to Recall.</p>
          <p>Your API key: <code>${key}</code></p>
          <p>Save this — it won't be shown again.</p>
          <p>A Solana wallet has been generated for you. Your vectors are encrypted with its key before reaching our servers.</p>
          <p>Dashboard: <a href="https://app.veclabs.xyz">app.veclabs.xyz</a></p>
          <p>Docs: <a href="https://docs.veclabs.xyz">docs.veclabs.xyz</a></p>
        `,
      });
    } catch (e) {
      console.warn('Welcome email failed:', e);
    }

    return NextResponse.json({ message: 'Provisioned', apiKey: key });

  } catch (err: any) {
    console.error('Provision error:', err.message, err.stack);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}