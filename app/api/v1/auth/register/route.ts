import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { stripe } from '@/lib/stripe';
import { generateApiKey } from '@/lib/keys';
import { Resend } from 'resend';

let _resend: Resend | null = null;
function getResend() {
  if (!_resend) _resend = new Resend(process.env.RESEND_API_KEY);
  return _resend;
}

export async function POST(req: NextRequest) {
  try {
    const { email, password } = await req.json();

    if (!email || !password) {
      return NextResponse.json({ error: 'Email and password required' }, { status: 400 });
    }

    const { data: authUser, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });

    if (authError) {
      return NextResponse.json({ error: authError.message }, { status: 400 });
    }

    const customer = await stripe.customers.create({
      email,
      metadata: { supabase_id: authUser.user.id },
    });

    await stripe.subscriptions.create({
      customer: customer.id,
      items: [{ price: process.env.STRIPE_FREE_TIER_PRICE_ID }],
    });

    await supabaseAdmin.from('users').insert({
      id: authUser.user.id,
      email,
      stripe_customer_id: customer.id,
      plan: 'free',
    });

    const { key, hash, prefix } = generateApiKey();

    await supabaseAdmin.from('api_keys').insert({
      user_id: authUser.user.id,
      key_hash: hash,
      key_prefix: prefix,
      name: 'Default',
    });

    await getResend().emails.send({
      from: 'Recall <hello@veclabs.xyz>',
      to: email,
      subject: 'Your Recall API key',
      html: `
        <p>Welcome to Recall.</p>
        <p>Your API key: <code>${key}</code></p>
        <p>Save this — it won't be shown again.</p>
        <p>Get started: <a href="https://docs.veclabs.xyz">docs.veclabs.xyz</a></p>
      `,
    });

    return NextResponse.json({
      message: 'Account created',
      apiKey: key,
      userId: authUser.user.id,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
