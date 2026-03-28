import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import Stripe from 'stripe';
import { generateApiKey } from '@/lib/keys';
import { Resend } from 'resend';

export async function POST(req: NextRequest) {
  console.log('PROVISION START');

  try {
    console.log('Provision called, auth header present:', !!req.headers.get('authorization'));

    const supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
      apiVersion: '2026-03-25.dahlia' as any,
    });

    // Authenticate using Supabase JWT
    const authHeader = req.headers.get('authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const jwt = authHeader.replace('Bearer ', '').trim();

    // Verify JWT with Supabase
    const { data: { user }, error: userError } = await supabaseAdmin.auth.getUser(jwt);
    if (userError || !user) {
      return NextResponse.json({ error: 'Invalid token' }, { status: 401 });
    }

    // Check if user already has a public.users row with stripe_customer_id
    const { data: existingUser } = await supabaseAdmin
      .from('users')
      .select('*')
      .eq('id', user.id)
      .single();

    // Check if user already has API keys
    const { data: existingKeys } = await supabaseAdmin
      .from('api_keys')
      .select('id')
      .eq('user_id', user.id)
      .eq('revoked', false);

    if (existingKeys && existingKeys.length > 0) {
      return NextResponse.json({ message: 'Already provisioned' }, { status: 200 });
    }

    // Create Stripe customer if not exists
    let stripeCustomerId = existingUser?.stripe_customer_id;
    if (!stripeCustomerId) {
      const customer = await stripe.customers.create({
        email: user.email!,
        metadata: { supabase_id: user.id },
      });
      stripeCustomerId = customer.id;

      // Subscribe to free tier
      try {
        await stripe.subscriptions.create({
          customer: stripeCustomerId,
          items: [{ price: process.env.STRIPE_FREE_TIER_PRICE_ID }],
        });
      } catch (stripeErr) {
        console.warn('Stripe free subscription failed:', stripeErr);
        // continue — don't crash provision
      }
    }

    // Upsert public.users row
    await supabaseAdmin.from('users').upsert({
      id: user.id,
      email: user.email!,
      full_name: user.user_metadata?.full_name ?? user.user_metadata?.name ?? null,
      stripe_customer_id: stripeCustomerId,
      plan: 'free',
    }, { onConflict: 'id' });

    // Generate first API key
    const { key, hash, prefix } = generateApiKey();
    await supabaseAdmin.from('api_keys').insert({
      user_id: user.id,
      key_hash: hash,
      key_prefix: prefix,
      name: 'Default',
    });

    // Send welcome email
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
          <p>Dashboard: <a href="https://app.veclabs.xyz">app.veclabs.xyz</a></p>
          <p>Docs: <a href="https://docs.veclabs.xyz">docs.veclabs.xyz</a></p>
        `,
      });
    } catch (e) {
      // Email failure should not break provisioning
      console.warn('Welcome email failed:', e);
    }

    return NextResponse.json({
      message: 'Provisioned',
      apiKey: key, // shown once
    });

  } catch (err: any) {
    console.error('Provision error:', err.message, err.stack);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
