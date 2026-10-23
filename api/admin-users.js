import crypto from 'crypto';
import { adminClient, fromAddress, handleApi, HttpError, requireUser, sendJson, toHtml, transporter } from './_shared.js';

const ALPHABET = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function tempPassword(len = 14) {
  const bytes = crypto.randomBytes(len);
  let out = '';
  for (let i = 0; i < len; i++) out += ALPHABET[bytes[i] % ALPHABET.length];
  return out;
}

async function emailCredentials(req, to, name, password, reset) {
  const origin = req.headers['origin'] || req.headers['referer'] || '';
  const site = (process.env.SITE_URL || origin || '').replace(/\/+$/, '');
  const text = `Hello ${name},\n\n${
    reset
      ? 'Your portal password was reset by the admin.'
      : 'You have been added as an issuer on the Certificate Portal.'
  }\n\nLogin: ${site}/login\nEmail: ${to}\nTemporary password: ${password}\n\nYou will be asked to choose your own password at first login.\n`;

  await transporter().sendMail({
    from: fromAddress(),
    to,
    subject: reset ? 'Your Certificate Portal password was reset' : 'Your Certificate Portal account',
    text,
    html: toHtml(text),
  });
}

export default handleApi(async (req, res) => {
  if (req.method !== 'POST') throw new HttpError(405, 'Method not allowed');

  const admin = adminClient();
  const { profile: caller } = await requireUser(req, admin);
  if (caller.role !== 'admin') throw new HttpError(403, 'Admins only');

  const b = req.parsedBody || {};

  if (b.action === 'create') {
    const email = String(b.email || '').trim().toLowerCase();
    const full_name = String(b.full_name || '').trim();
    const department = String(b.department || '').trim();

    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new HttpError(400, 'Enter a valid email address');
    if (!full_name) throw new HttpError(400, 'Name is required');

    const password = tempPassword();
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name },
    });

    if (error || !data?.user) {
      throw new HttpError(
        400,
        /already|registered/i.test(error?.message || '')
          ? 'An account with this email already exists'
          : error?.message || 'Could not create user'
      );
    }

    const { error: pErr } = await admin.from('profiles').insert({
      id: data.user.id,
      role: 'issuer',
      full_name,
      department,
      email,
      status: 'active',
      must_change_password: true,
      created_by: caller.id,
    });

    if (pErr) {
      await admin.auth.admin.deleteUser(data.user.id);
      throw new HttpError(500, pErr.message);
    }

    await admin.from('audit_logs').insert({
      actor_id: caller.id,
      actor_name: caller.full_name,
      action: 'issuer.created',
      entity: 'profile',
      entity_id: data.user.id,
      meta: { email, full_name, department },
    });

    let email_sent = false;
    let email_error = '';
    try {
      await emailCredentials(req, email, full_name, password, false);
      email_sent = true;
    } catch (e) {
      email_error = String(e.message || e).slice(0, 120);
    }

    return sendJson(res, { user_id: data.user.id, email, temp_password: password, email_sent, email_error });
  }

  if (b.action === 'reset_password') {
    const { data: target } = await admin.from('profiles').select('*').eq('id', b.user_id).maybeSingle();
    if (!target) throw new HttpError(404, 'User not found');

    const password = tempPassword();
    const { error } = await admin.auth.admin.updateUserById(target.id, { password });
    if (error) throw new HttpError(400, error.message);

    await admin.from('profiles').update({ must_change_password: true }).eq('id', target.id);
    await admin.from('audit_logs').insert({
      actor_id: caller.id,
      actor_name: caller.full_name,
      action: 'issuer.password_reset',
      entity: 'profile',
      entity_id: target.id,
      meta: { email: target.email },
    });

    let email_sent = false;
    let email_error = '';
    try {
      await emailCredentials(req, target.email, target.full_name, password, true);
      email_sent = true;
    } catch (e) {
      email_error = String(e.message || e).slice(0, 120);
    }

    return sendJson(res, { user_id: target.id, email: target.email, temp_password: password, email_sent, email_error });
  }

  throw new HttpError(400, 'Unknown action');
});
