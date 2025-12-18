// src/utils/email.ts
import { Resend } from "resend";

export interface SendEmailInput {
  to: string | string[];
  cc?: string | string[] | null;
  bcc?: string | string[] | null;
  subject: string;
  text?: string | null;
  html?: string | null;
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
//  RESEND CLIENT (lazy init – bez crascha na starcie)
// ----------------------------------------------
function getResendClient() {
  const key = process.env.RESEND_API_KEY;
  if (!key) return null;
  return new Resend(key);
}

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

export function buildPortalEmailHtml(subject: string, bodyText: string): string {
  const safeSubject = escapeHtml(subject || "Informacja ze sprawy Portal PK");
  const bodyHtml = renderBodyAsHtml(bodyText);
  const brandTitle = "Portal PK";

  return `<!doctype html>
<html lang="pl">
  <head>
    <meta charset="utf-8" />
    <title>${safeSubject}</title>
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>
      @media (max-width: 640px) {
        .pk-container { width: 100% !important; padding: 0 12px !important; }
      }
    </style>
  </head>
  <body style="margin:0; padding:0; background-color:#f3f4f6; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f3f4f6; padding:24px 0;">
      <tr>
        <td align="center">
          <table role="presentation" class="pk-container" width="620" cellpadding="0" cellspacing="0"
            style="width:620px; max-width:100%; background-color:#ffffff; border-radius:12px; overflow:hidden; box-shadow:0 8px 24px rgba(15,23,42,0.12);">
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
//  SEND (RESEND)
// ----------------------------------------------
export async function sendEmail(opts: SendEmailInput): Promise<SendEmailResult> {
  const resend = getResendClient();
  if (!resend) {
    return { ok: false, messageId: null, error: "Brak RESEND_API_KEY w .env" };
  }

  // UWAGA: FROM musi być w domenie zweryfikowanej w Resend.
  const from = process.env.MAIL_FROM || "Portal PK <portal@mail.pokonajkredyt.pl>";

  const htmlBody =
    opts.html ||
    buildPortalEmailHtml(
      opts.subject || "Informacja ze sprawy Portal PK",
      opts.text || ""
    );

  // Resend lubi tablice stringów
  const to = Array.isArray(opts.to) ? opts.to : [opts.to];
  const cc = opts.cc ? (Array.isArray(opts.cc) ? opts.cc : [opts.cc]) : undefined;
  const bcc = opts.bcc
    ? (Array.isArray(opts.bcc) ? opts.bcc : [opts.bcc])
    : undefined;

  try {
    const r = await resend.emails.send({
      from,
      to,
      cc,
      bcc,
      subject: opts.subject,
      text: opts.text || undefined,
      html: htmlBody,
    });

    // Resend zwraca { id: "..." } lub { data: { id } } zależnie od wersji SDK
    const messageId =
      (r as any)?.id || (r as any)?.data?.id || null;

    console.log("📧 EMAIL SENT (Resend):", {
      to,
      subject: opts.subject,
      messageId,
      caseId: opts.caseId,
      actorId: opts.actorId,
    });

    return { ok: true, messageId, error: null };
  } catch (err: any) {
    console.error("❌ Email send error (Resend):", err);
    return { ok: false, messageId: null, error: err?.message || String(err) };
  }
}