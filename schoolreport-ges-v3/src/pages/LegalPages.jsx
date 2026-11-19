import { Link } from 'react-router'

const CONTACT = 'support@schoolreport.online'
const UPDATED = '19 November 2026'

function Page({ title, children }) {
  return (
    <div className="min-h-screen bg-bg px-4 py-10">
      <article className="max-w-2xl mx-auto bg-white rounded-2xl border border-border p-6 sm:p-8 text-[14px] leading-relaxed text-gray-700">
        <Link to="/login" className="text-xs text-blue">← SchoolReport</Link>
        <h1 className="text-2xl font-bold text-gray-900 mt-2">{title}</h1>
        <p className="text-xs text-gray-400 mb-5">Last updated {UPDATED}</p>
        <div className="space-y-4 [&_h2]:text-base [&_h2]:font-bold [&_h2]:text-gray-900 [&_h2]:mt-6 [&_ul]:list-disc [&_ul]:pl-5 [&_li]:mb-1">{children}</div>
      </article>
    </div>
  )
}

export function PrivacyPage() {
  return (
    <Page title="Privacy Policy">
      <p>SchoolReport is an online service that Ghanaian schools use for report cards, attendance, school fees and messages to parents. This policy explains what information is kept, why, and your rights under Ghana's Data Protection Act, 2012 (Act 843).</p>
      <h2>Who is responsible</h2>
      <p>Each school decides what it records about its pupils, parents and staff, and is responsible for that information (the "data controller"). SchoolReport stores and processes it on the school's behalf and only to provide the service (the "data processor"). For the accounts of people who sign a school up, SchoolReport is responsible.</p>
      <h2>What is kept</h2>
      <ul>
        <li>Pupils: name, gender, date of birth, class, marks, report remarks, attendance and school fee records.</li>
        <li>Parents and guardians: name and phone number(s), as given by the school.</li>
        <li>Staff: name, email address, role and class.</li>
        <li>Records of who changed what and when (to protect against mistakes and misuse), and basic technical logs.</li>
      </ul>
      <h2>What it is used for</h2>
      <p>Only to run the service for the school: producing reports, keeping registers and fee accounts, letting parents see their own child's information, and sending the messages the school asks for (for example absence alerts, notices and fee reminders by SMS). Information is never sold and never used for advertising.</p>
      <h2>Who else handles it</h2>
      <ul>
        <li>Amazon Web Services stores the data, encrypted, in its Stockholm (Sweden) data centre.</li>
        <li>Brevo sends emails (such as sign-in and password codes).</li>
        <li>An SMS provider delivers text messages; only the phone number and the message are shared.</li>
        <li>Paystack processes online payments; card and Mobile Money details are entered on Paystack's page and never reach SchoolReport.</li>
      </ul>
      <h2>How it is protected</h2>
      <p>All connections are encrypted. Passwords and sign-in codes are stored only in scrambled (hashed) form. Each school sees only its own data; teachers see only their own class; parents see only their own children. Access is logged.</p>
      <h2>How long it is kept</h2>
      <p>For as long as the school uses SchoolReport. When a school leaves, it can ask for a copy and then for deletion; backups are overwritten within 7 days.</p>
      <h2>Your rights</h2>
      <p>You can ask to see, correct or delete information about you or your child. Please ask the school first, since it controls the records; you can also write to {CONTACT}. If you are not satisfied, you may complain to the Data Protection Commission of Ghana.</p>
      <h2>Children</h2>
      <p>Pupils' information is entered by their school. Children do not sign up themselves.</p>
      <h2>Contact</h2>
      <p>{CONTACT}</p>
    </Page>
  )
}

export function TermsPage() {
  return (
    <Page title="Terms of Use">
      <p>These terms apply to schools using SchoolReport and to the people who use it for them.</p>
      <h2>The service</h2>
      <p>SchoolReport provides report cards, attendance registers, school fee records, parent access and messaging over the internet. We work to keep it available and secure, but cannot promise it will never be interrupted.</p>
      <h2>The school's responsibilities</h2>
      <ul>
        <li>The person signing up is allowed to do so for the school.</li>
        <li>The school is responsible for the accuracy of what it records and for having a lawful basis (including any consent required) to record pupils' and parents' information and to message parents.</li>
        <li>Each user keeps their password and sign-in codes private.</li>
      </ul>
      <h2>Trial, prices and payment</h2>
      <p>New schools get a free trial. After it, the school pays per term, priced by the number of pupils on roll, as shown on the Billing page before paying. If a trial or paid term ends and is not renewed, the school keeps full use for a grace period of 14 days and then becomes read-only: everything can still be viewed and printed, but not changed, until it pays. SMS have a monthly allowance per school.</p>
      <h2>School fees paid online</h2>
      <p>When a school accepts online fee payments, parents pay through Paystack and the money is settled directly to the school's own account. Refunds and disputes about school fees are between the parent and the school.</p>
      <h2>The school's data</h2>
      <p>The school's data belongs to the school. It can print or export it at any time and ask for it to be deleted when it stops using SchoolReport.</p>
      <h2>Liability</h2>
      <p>SchoolReport is not liable for indirect losses, or for decisions made using information entered by the school. Our total liability is limited to the fees the school paid in the last 12 months.</p>
      <h2>Changes</h2>
      <p>We may update these terms and will tell schools before important changes take effect. These terms are governed by the laws of Ghana.</p>
      <h2>Contact</h2>
      <p>{CONTACT}</p>
    </Page>
  )
}
