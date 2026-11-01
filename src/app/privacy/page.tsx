import type { Metadata } from "next";
import Link from "next/link";
import { siteConfig } from "@/config/site";
import { getPlatformLegalConfig } from "@/lib/legal/platform-config";
import { LegalBackButton } from "@/components/legal/legal-back-button";

export const metadata: Metadata = {
  title: `Privacy Policy — ${siteConfig.name}`,
};

export default function PrivacyPolicyPage() {
  const config = getPlatformLegalConfig();

  return (
    <main className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
      <LegalBackButton />

      <h1 className="mt-4 text-3xl font-semibold tracking-tight text-text-primary">Privacy Policy</h1>
      <p className="mt-2 text-sm text-text-muted">Effective {config.privacyEffectiveDate}</p>

      <div className="mt-10 space-y-10 text-sm leading-relaxed text-text-secondary">
        <section>
          <h2 className="text-lg font-semibold text-text-primary">1. Who this policy covers</h2>
          <p className="mt-3">
            {siteConfig.name} (the &ldquo;Service&rdquo;), a client relationship management tool that lets a
            business (an &ldquo;Organization&rdquo;) manage its own clients, projects, tasks, invoices, and files,
            and optionally invite its clients to a limited self-service &ldquo;Client Portal&rdquo;, is operated
            by {config.operatorDescription} (&ldquo;we&rdquo;, &ldquo;us&rdquo;).
            {config.brandDisclaimer ? ` ${config.brandDisclaimer}` : ""}
          </p>
          <p className="mt-3">
            This policy applies to everyone who uses the Service: staff members of an Organization, and Client
            Portal users invited by an Organization. If you are a client of one of our Organizations, that
            Organization &mdash; not us &mdash; controls the business data it enters about you, and is the right
            party to contact about that data. We act as the Organization&rsquo;s data processor for that
            information.
            {config.legalAddress ? ` Our postal address is ${config.legalAddress}.` : ""}
          </p>
          <p className="mt-3">
            Section 2 also describes the limited information we may collect about visitors to our marketing website
            at aqenra.com, if we enable website analytics.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-text-primary">2. Information we collect</h2>
          <p className="mt-3">We collect the following categories of information:</p>
          <ul className="mt-3 list-disc space-y-2 pl-5">
            <li>
              <strong className="text-text-primary">Account information.</strong> Name, email address, and password
              for staff and Client Portal accounts. Passwords are handled entirely by our authentication
              provider (Supabase Auth) and stored as a salted hash &mdash; we never see or store a plaintext
              password. If a staff member voluntarily adds a phone number as an additional account-recovery
              option, we store that phone number too.
            </li>
            <li>
              <strong className="text-text-primary">Staff sign-up records.</strong> When someone starts creating a
              staff account, we record the email address entered, the time of the first and the most recent
              recorded attempt, how many attempts we recorded, whether the sign-up was made on its own or through a
              team invitation, and, once the email is confirmed and the account is created, the time that
              happened. This includes attempts that are never completed through email confirmation. We use it to
              understand how many people start and finish sign-up and to look into sign-up problems. This record
              does not contain your password, confirmation links, IP address, or browser details.
            </li>
            <li>
              <strong className="text-text-primary">Organization and business data.</strong> Information an
              Organization&rsquo;s staff enter into the Service, including organization/business identity details,
              client contacts, projects, tasks, invoices, comments, and activity history.
            </li>
            <li>
              <strong className="text-text-primary">Files you upload.</strong> Documents and other files attached to
              clients, projects, or tasks are stored in our file storage provider (Supabase Storage) under an
              access-controlled path scoped to the uploading Organization.
            </li>
            <li>
              <strong className="text-text-primary">Client Portal data.</strong> If an Organization invites you to
              its Client Portal, we store your name, email address, and the record of which Organization/client
              relationship the invitation was for.
            </li>
            <li>
              <strong className="text-text-primary">Notification preferences.</strong> Which in-app and email
              notifications you have chosen to receive.
            </li>
            <li>
              <strong className="text-text-primary">Support messages.</strong> If you contact us for help before
              creating an account &mdash; for example, through a support form on our sign-in or sign-up pages
              &mdash; we collect the email address, issue category, and message you provide, and use it only to
              respond to your request. These messages are sent using the same email provider named in Section 4.
            </li>
            <li>
              <strong className="text-text-primary">Feedback from inside the app.</strong> If you contact support or
              report a bug from the feedback button while signed in, we collect what you write, your account name and
              email address, your role, and your workspace name. For a bug report we also collect the path of the page
              you were on (never its search terms or contents), the time, and your browser and device details. We use
              this only to respond to you and to fix the problem, and we never attach your passwords, cookies, session
              tokens, or what you have typed into other forms. These messages are sent using the same email provider
              named in Section 4.
            </li>
            <li>
              <strong className="text-text-primary">Technical data.</strong> Requests to the Service are processed
              transiently (e.g. to enforce rate limits that protect against abuse) and are not written to a
              persistent log we control. Our hosting provider (Vercel) may separately retain standard
              infrastructure request logs (such as IP address and timestamps) as part of operating the servers
              the Service runs on.
            </li>
            <li>
              <strong className="text-text-primary">Website analytics (if enabled).</strong> We may measure traffic to
              our marketing website at aqenra.com using Vercel Web Analytics, provided by Vercel as our service
              provider. If and when we switch it on, it records page views and approximate visitor counts, the web
              address of the page viewed, the referring website, and the country, device type, browser, and
              operating system that Vercel derives from the request. A web address can include a query string (the
              part after a question mark); we intend to remove query strings before this measurement is sent, and
              this page will say when it is switched on. According to Vercel, it does not use cookies, and we add
              no cookies or other browser storage of our own for it. Visitors are counted using an identifier
              derived from the request that resets daily; Vercel states that this means a visitor cannot be tracked
              from one day to the next or across websites. We use it only to understand how the website is used and
              to improve it. Aqenra does not store IP addresses or individual visit records from this measurement:
              we view aggregate daily counts. Vercel keeps this data available to us for the reporting window of our
              hosting plan and may keep it for longer; we do not control that and cannot promise a deletion date.
              Our hosting provider may separately retain standard request logs, as described under Technical data.
            </li>
          </ul>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-text-primary">3. How we use information</h2>
          <p className="mt-3">We use the information above only to:</p>
          <ul className="mt-3 list-disc space-y-2 pl-5">
            <li>Provide, operate, and maintain the Service, including authenticating you and enforcing access
              controls between Organizations;</li>
            <li>Send transactional email you&rsquo;ve triggered or that is necessary to your account, such as
              invitations, password reset links, and notifications you&rsquo;ve opted into;</li>
            <li>Respond to support requests you send us, including before you have an account;</li>
            <li>Detect, prevent, and respond to abuse, fraud, and security incidents; and</li>
            <li>Comply with legal obligations.</li>
          </ul>
          <p className="mt-3">
            We do not sell personal information, and we do not use your data for advertising. We do not
            currently use third-party analytics or advertising trackers inside the application itself. Measurement of
            our marketing website is described in Section 2 and applies only if and when we switch it on. We use first-party
            cookies to support sign-in, remember your active workspace, and retain display preferences such as
            your selected theme. We also use browser-local storage for certain preferences and features,
            including saved views, table column settings, recently selected search results, and dismissal of the
            public-beta notice. Unlike cookies, browser-local storage is kept on your device and is not
            automatically sent with every request to our servers. See our{" "}
            <Link
              href="/cookies"
              className="rounded font-medium text-text-primary hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2"
            >
              Cookie Policy
            </Link>{" "}
            for the full list, including retention periods and how to manage them.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-text-primary">4. Who we share information with</h2>
          <p className="mt-3">
            We do not sell or rent personal information. We share information only with the service providers
            that operate the infrastructure the Service is built on (our &ldquo;sub-processors&rdquo;), each
            acting under its own data protection terms:
          </p>
          <ul className="mt-3 list-disc space-y-2 pl-5">
            <li><strong className="text-text-primary">Supabase</strong> &mdash; database hosting, authentication, and file storage.</li>
            <li><strong className="text-text-primary">Resend</strong> &mdash; delivery of transactional email (invitations, password resets, notifications).</li>
            <li><strong className="text-text-primary">Vercel</strong> &mdash; application hosting and infrastructure and, if we enable it, cookieless website analytics for aqenra.com.</li>
          </ul>
          <p className="mt-3">
            Staff data you enter about your own clients is visible to other staff members of your Organization
            according to their role, and to any Client Portal user you explicitly invite, scoped to that
            client&rsquo;s own records. We otherwise never share your data across Organizations.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-text-primary">5. Payments</h2>
          <p className="mt-3">
            The Service does not currently process live payments through any payment provider. No card or bank
            details are collected or stored by us today. If we begin processing real subscription payments in
            the future, this policy will be updated first to name the payment processor and describe what it
            collects, before any such feature is enabled.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-text-primary">6. Data retention</h2>
          <p className="mt-3">
            We retain account and business data for as long as your account or Organization remains active. Read
            in-app notifications are automatically deleted 90 days after they are marked read; unread
            notifications are kept until you read or otherwise clear them.
          </p>
          <p className="mt-3">
            Staff sign-up records for attempts that were never completed into an account are deleted automatically
            once 90 days have passed since the most recent recorded attempt. This cleanup runs daily, in batches,
            so a record may remain for a short time after the 90 days end. Sign-up records for completed accounts
            are kept for as long as the account remains active. The cleanup removes only the sign-up record; it
            does not delete or change any account held by our authentication provider (Supabase Auth). To ask us to
            delete that data, contact us using the details in Section 9.
          </p>
          <p className="mt-3">
            We do not currently offer a self-service &ldquo;delete my account&rdquo; or &ldquo;export my
            data&rdquo; control inside the Service. To request deletion or a copy of your data, contact us using
            the details in Section 9 and we will handle the request manually.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-text-primary">7. Security</h2>
          <p className="mt-3">
            Data is encrypted in transit over HTTPS. Access to an Organization&rsquo;s data is restricted to its
            own staff and any Client Portal users it invites; our infrastructure enforces this separation at the
            database and storage layer. No method of transmission or storage is 100% secure, and we cannot
            guarantee absolute security.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-text-primary">8. Changes to this policy</h2>
          <p className="mt-3">
            We may update this policy as the Service changes. If we make a material change, we will update the
            effective date above; continued use of the Service after a change constitutes acceptance of the
            updated policy.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-text-primary">9. Contact us</h2>
          <p className="mt-3">
            {config.supportEmail ? (
              <>
                Questions about this policy, or requests to access, correct, or delete your data, can be sent to{" "}
                <a
                  href={`mailto:${config.supportEmail}`}
                  className="rounded font-medium text-text-primary hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2"
                >
                  {config.supportEmail}
                </a>
                .
              </>
            ) : (
              <>
                To ask a question about this policy, or to request access to, correction of, or deletion of your
                data, contact your Organization&rsquo;s administrator, or reach us through the channel we used to
                communicate with you.
              </>
            )}{" "}
            This policy is interpreted under the laws applicable in {config.jurisdiction}.
          </p>
        </section>
      </div>
    </main>
  );
}
