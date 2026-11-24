import { Logger } from '@nestjs/common';
import { accountWebOrigins } from './account-http';

const escape = (value: string) => value.replace(/[&<>"']/g, character => `&#${character.charCodeAt(0)};`);

export class PasswordResetMailer {
  private readonly logger = new Logger(PasswordResetMailer.name);

  configured() { return Boolean(process.env.RESEND_API_KEY && process.env.PLAYSPORT_MAIL_FROM); }

  link(token: string) { return `${accountWebOrigins()[0]}/account/reset#token=${token}`; }

  async send(to: string, displayName: string, token: string) {
    const link = this.link(token);
    if (!this.configured()) {
      if (process.env.NODE_ENV !== 'production') this.logger.warn(`Correo no configurado; enlace local de recuperación para ${to}: ${link}`);
      return;
    }
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST', signal: AbortSignal.timeout(10000),
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: process.env.PLAYSPORT_MAIL_FROM, to: [to], subject: 'Restablece tu contraseña de PlaySport',
        text: `Hola, ${displayName}:\n\nPara elegir una nueva contraseña abre este enlace (vence en 30 minutos y solo sirve una vez):\n${link}\n\nSi no lo pediste, ignora este correo; tu contraseña no cambia.`,
        html: `<p>Hola, ${escape(displayName)}:</p><p>Para elegir una nueva contraseña de PlaySport pulsa el botón. El enlace vence en 30 minutos y solo sirve una vez.</p>` +
          `<p><a href="${escape(link)}" style="background:#d71920;color:#fff;padding:12px 18px;border-radius:6px;text-decoration:none;font-weight:bold">Elegir nueva contraseña</a></p>` +
          `<p>Si no lo pediste, ignora este correo; tu contraseña no cambia.</p>`
      })
    });
    if (!response.ok) throw new Error(`Resend respondió ${response.status}: ${(await response.text()).slice(0, 300)}`);
  }
}
