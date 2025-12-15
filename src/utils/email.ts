// src/utils/email.ts
import nodemailer from "nodemailer";

export interface SendEmailInput {
  to: string | string[];
  cc?: string | string[] | null;
  bcc?: string | string[] | null;
  subject: string;
  text?: string | null;   // zwykły tekst z frontu (np. textarea)
  html?: string | null;   // jeśli kiedyś będziemy chcieli wstrzyknąć własny HTML
  caseId?: number | null;
  actorId?: number | null;
  tag?: string | null;
}

export interface SendEmailResult {
  ok: boolean;
  messageId?: string | null;
  error?: string | null;
}

// ----------------------------------------------
//  SMTP TRANSPORTER (Portal PK)
// ----------------------------------------------
const smtpHost = process.env.SMTP_HOST || "mail.pokonajkredyt.pl";
const smtpPort = Number(process.env.SMTP_PORT || 465);
// przy 465 używamy SSL
const smtpSecure = smtpPort === 465;

const transporter = nodemailer.createTransport({
  host: smtpHost,
  port: smtpPort,
  secure: smtpSecure,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

// ----------------------------------------------
//  HELPERY DO HTML
// ----------------------------------------------
function escapeHtml(str: string): string {
  return (str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function renderBodyAsHtml(bodyText: string): string {
  if (!bodyText) return "";

  // Dzielimy na akapity po pustej linii
  const paragraphs = bodyText.split(/\n{2,}/);

  return paragraphs
    .map((p) => {
      const escaped = escapeHtml(p).replace(/\n/g, "<br>");
      return `<p style="margin:0 0 14px 0; line-height:1.6; color:#111827; font-size:14px;">
        ${escaped}
      </p>`;
    })
    .join("");
}

function buildPortalEmailHtml(subject: string, bodyText: string): string {
  const safeSubject = escapeHtml(subject || "Informacja ze sprawy Portal PK");
  const bodyHtml = renderBodyAsHtml(bodyText);

  // Tu możesz później podmienić nagłówek na <img src="...logo..." />
  const brandTitle = "Portal PK";

  return `<!doctype html>
<html lang="pl">
  <head>
    <meta charset="utf-8" />
    <title>${safeSubject}</title>
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>
      /* minimum, większość styli i tak trzymamy inline */
      @media (max-width: 640px) {
        .pk-container {
          width: 100% !important;
          padding: 0 12px !important;
        }
      }
    </style>
  </head>
  <body style="margin:0; padding:0; background-color:#f3f4f6; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f3f4f6; padding:24px 0;">
      <tr>
        <td align="center">
          <table role="presentation" class="pk-container" width="620" cellpadding="0" cellspacing="0" style="width:620px; max-width:100%; background-color:#ffffff; border-radius:12px; overflow:hidden; box-shadow:0 8px 24px rgba(15,23,42,0.12);">
            <!-- HEADER -->
            <tr>
              <td style="background:linear-gradient(90deg,#b91c1c,#7f1d1d); padding:20px 28px;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                  <tr>
                    <td style="font-size:20px; font-weight:700; color:#ffffff; letter-spacing:0.02em;">
                      ${brandTitle}
                    </td>
                    <td align="right" style="font-size:11px; color:#fee2e2;">
                      Informacja dotycząca Twojej sprawy
                    </td>
                  </tr>
                </table>
              </td>
            </tr>

            <!-- CONTENT -->
            <tr>
              <td style="padding:24px 28px 8px 28px;">
                <div style="font-size:16px; font-weight:600; margin-bottom:12px; color:#111827;">
                  ${safeSubject}
                </div>
                <div style="font-size:14px; color:#111827; line-height:1.6;">
                  ${bodyHtml}
                </div>
              </td>
            </tr>

            <!-- FOOTER -->
            <tr>
              <td style="padding:16px 28px 24px 28px; border-top:1px solid #e5e7eb;">
                <div style="font-size:11px; color:#6b7280; line-height:1.5;">
                  Ta wiadomość została wysłana automatycznie z systemu Portal PK
                  (<a href="https://portal.pokonajkredyt.pl" style="color:#b91c1c; text-decoration:none;">portal.pokonajkredyt.pl</a>).
                  Jeśli nie rozpoznajesz tej wiadomości, skontaktuj się z nami.
                </div>
                <div style="height:8px;"></div>
                <div style="font-size:11px; color:#9ca3af;">
                  Pokonaj Kredyt · www.pokonajkredyt.pl · tel. 503 895 005
                </div>
              </td>
            </tr>
          </table>

          <!-- drobny dopisek pod kartą -->
          <div style="margin-top:12px; font-size:10px; color:#9ca3af;">
            Proszę nie odpowiadać bezpośrednio na ten e-mail, jeśli w treści wiadomości wskazano inaczej.
          </div>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

// ----------------------------------------------
//  Właściwa funkcja wysyłki
// ----------------------------------------------
export async function sendEmail(
  opts: SendEmailInput
): Promise<SendEmailResult> {
  const from =
    process.env.MAIL_FROM ||
    '"Portal PK" <portal@pokonajkredyt.pl>';

  // Jeżeli ktoś poda własny HTML – używamy go.
  // Jeżeli NIE poda – budujemy brandowy szablon na bazie `text`.
  const htmlBody =
    opts.html ||
    buildPortalEmailHtml(
      opts.subject || "Informacja ze sprawy Portal PK",
      opts.text || ""
    );

  try {
    const info = await transporter.sendMail({
      from,
      to: opts.to,
      cc: opts.cc || undefined,
      bcc: opts.bcc || undefined,
      subject: opts.subject,
      text: opts.text || undefined, // fallback dla starych klientów poczty
      html: htmlBody,               // ✨ nasz ładny HTML
    });

    console.log("📧 EMAIL SENT:", {
      to: opts.to,
      subject: opts.subject,
      messageId: info.messageId,
      caseId: opts.caseId,
      actorId: opts.actorId,
    });

    return {
      ok: true,
      messageId: info.messageId,
      error: null,
    };
  } catch (err: any) {
    console.error("❌ Email send error:", err);

    return {
      ok: false,
      messageId: null,
      error: err?.message || String(err),
    };
  }
}