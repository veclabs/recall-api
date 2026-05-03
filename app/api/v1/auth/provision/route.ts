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
    // This is the key used to encrypt their vectors before Irys upload
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
        from: 'Dhir at Recall <hello@veclabs.xyz>',
        to: user.email!,
        subject: 'Welcome to Recall',
        html: `
          <div style="font-family: ui-monospace, monospace; max-width: 560px; margin: 0 auto; padding: 40px 20px; color: #111;">
            <div style="margin-bottom: 32px;">
              <div style="display: inline-block; background: #111; color: #fff; padding: 6px 12px; font-size: 13px; font-weight: 600; letter-spacing: 0.06em;">
                RECALL
              </div>
            </div>
      
            <h1 style="font-size: 22px; font-weight: 700; color: #111; margin: 0 0 16px; letter-spacing: -0.02em; line-height: 1.2;">
              Welcome to Recall.
            </h1>
      
            <p style="font-size: 14px; color: #444; line-height: 1.7; margin: 0 0 24px;">
              Hi — I'm Dhir, I built Recall. Thanks for signing up.
            </p>
      
            <p style="font-size: 14px; color: #444; line-height: 1.7; margin: 0 0 24px;">
              Recall gives your AI agents persistent, verifiable memory. Every write produces a SHA-256 Merkle root posted to Solana — a cryptographic proof of what your agent remembered at that point in time.
            </p>
      
            <div style="background: #f9f9f9; border: 1px solid #e8e8e8; padding: 20px 24px; margin: 0 0 24px;">
              <p style="font-size: 12px; color: #999; margin: 0 0 12px; text-transform: uppercase; letter-spacing: 0.1em;">
                Get started
              </p>
              <p style="font-size: 13px; color: #111; margin: 0 0 8px; font-family: monospace;">
                1. Your API key is in your dashboard
              </p>
              <p style="font-size: 13px; color: #111; margin: 0 0 8px; font-family: monospace;">
                2. npm install @veclabs/solvec
              </p>
              <p style="font-size: 13px; color: #111; margin: 0; font-family: monospace;">
                3. Start building
              </p>
            </div>
      
            <div style="margin: 0 0 24px;">
              <a href="https://app.veclabs.xyz" style="display: inline-block; background: #111; color: #fff; padding: 10px 20px; font-size: 13px; text-decoration: none; margin-right: 12px; font-family: monospace; letter-spacing: 0.04em;">
                Open dashboard →
              </a>
              <a href="https://docs.veclabs.xyz" style="display: inline-block; color: #111; padding: 10px 0; font-size: 13px; text-decoration: none; font-family: monospace; border-bottom: 1px solid #111;">
                Read the docs ↗
              </a>
            </div>
      
            <p style="font-size: 14px; color: #444; line-height: 1.7; margin: 0 0 8px;">
              If you run into anything or have questions — reply to this email directly. I read every message.
            </p>
      
            <p style="font-size: 14px; color: #444; line-height: 1.7; margin: 0 0 32px;">
              — Dhir
            </p>
      
            <div style="border-top: 1px solid #f0f0f0; padding-top: 20px;">
              <p style="font-size: 11px; color: #bbb; margin: 0; font-family: monospace;">
                VecLabs · veclabs.xyz · hello@veclabs.xyz
              </p>
            </div>
          </div>
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