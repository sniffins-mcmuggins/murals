'use client'

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8080'

async function handleSetup() {
  try {
    const res = await fetch(`${API_URL}/billing/organiser/setup-checkout`, {
      method: 'POST',
      credentials: 'include',
    })
    if (!res.ok) return
    const data = (await res.json()) as { checkout_url?: string }
    if (data.checkout_url) window.location.href = data.checkout_url
  } catch {
    // noop
  }
}

async function handleManage() {
  try {
    const res = await fetch(`${API_URL}/billing/portal`, {
      method: 'POST',
      credentials: 'include',
    })
    if (!res.ok) return
    const data = (await res.json()) as { portal_url?: string }
    if (data.portal_url) window.location.href = data.portal_url
  } catch {
    // noop
  }
}

export default function OrgBillingPage() {
  return (
    <div className="max-w-2xl mx-auto">
      <h1 className="font-serif text-4xl text-ink mb-8">Organiser billing</h1>

      <div className="flex flex-col gap-6">
        <div className="border border-light rounded-xl p-8">
          <h2 className="font-semibold mb-2">Setup fee</h2>
          <p className="text-mid mb-4">
            One-time £35 to activate your organiser account and publish your first festival.
          </p>
          <button
            type="button"
            onClick={handleSetup}
            className="bg-amber text-ink font-semibold border-none rounded-md px-6 py-3 cursor-pointer"
          >
            Pay setup fee — £35
          </button>
        </div>

        <div className="border border-light rounded-xl p-8">
          <h2 className="font-semibold mb-2">Festival costs</h2>
          <ul className="text-mid list-none p-0 flex flex-col gap-2">
            <li>£99 — Festival activation (one-off, per festival)</li>
            <li>£49/yr — Annual listing fee (keeps festival page live after the event)</li>
          </ul>
          <p className="mt-4 text-sm text-mid">
            Festival activation is paid from the festival&apos;s edit page once your application
            form is ready.
          </p>
        </div>

        <div className="border-t border-light pt-6">
          <button
            type="button"
            onClick={handleManage}
            className="text-amber font-semibold bg-transparent border-none cursor-pointer p-0"
          >
            Manage billing &amp; payment methods →
          </button>
        </div>
      </div>
    </div>
  )
}
