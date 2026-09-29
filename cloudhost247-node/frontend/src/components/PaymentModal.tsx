import React, { useState } from 'react';
import { initiatePayment, type PaymentAttempt } from '../lib/billing-api';

interface PaymentModalProps {
  invoiceId: string;
  invoiceNumber: string;
  totalAmount: string;
  currency: string;
  isOpen: boolean;
  onClose: () => void;
  onPaymentSuccess?: () => void;
}

export default function PaymentModal({
  invoiceId,
  invoiceNumber,
  totalAmount,
  currency,
  isOpen,
  onClose,
  onPaymentSuccess,
}: PaymentModalProps) {
  const [gateway, setGateway] = useState<'manual' | 'sandbox'>('manual');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activePayment, setActivePayment] = useState<PaymentAttempt | null>(null);

  if (!isOpen) return null;

  async function handleInitiate(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const payment = await initiatePayment(invoiceId, gateway);
      setActivePayment(payment);
      if (gateway === 'sandbox' && onPaymentSuccess) {
        // In sandbox mode, notify parent component
        onPaymentSuccess();
      }
    } catch (err: any) {
      setError(err?.message || 'Failed to initiate payment');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="relative w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl dark:bg-slate-900 dark:text-white">
        <button
          onClick={onClose}
          className="absolute right-4 top-4 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
          aria-label="Close modal"
        >
          ✕
        </button>

        <h3 className="text-xl font-bold tracking-tight">Pay Invoice {invoiceNumber}</h3>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Total Due: <span className="font-semibold text-slate-900 dark:text-white">{currency} ${totalAmount}</span>
        </p>

        {error && (
          <div className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950/50 dark:text-red-300">
            {error}
          </div>
        )}

        {!activePayment ? (
          <form onSubmit={handleInitiate} className="mt-6 space-y-4">
            <div>
              <label className="text-sm font-medium text-slate-700 dark:text-slate-300">Select Payment Method</label>
              <div className="mt-2 space-y-2">
                <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-slate-200 p-3 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800/50">
                  <input
                    type="radio"
                    name="gateway"
                    value="manual"
                    checked={gateway === 'manual'}
                    onChange={() => setGateway('manual')}
                    className="mt-1"
                  />
                  <div>
                    <div className="font-medium">Manual Bank Transfer / Wire</div>
                    <div className="text-xs text-slate-500">
                      Transfer directly to our corporate bank account. Verified by billing staff.
                    </div>
                  </div>
                </label>

                <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-slate-200 p-3 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800/50">
                  <input
                    type="radio"
                    name="gateway"
                    value="sandbox"
                    checked={gateway === 'sandbox'}
                    onChange={() => setGateway('sandbox')}
                    className="mt-1"
                  />
                  <div>
                    <div className="font-medium">Sandbox Gateway (Demo / Testing)</div>
                    <div className="text-xs text-slate-500">
                      Simulated payment flow for development and acceptance testing.
                    </div>
                  </div>
                </label>
              </div>
            </div>

            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                onClick={onClose}
                className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-medium hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={loading}
                className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-blue-700 disabled:opacity-50"
              >
                {loading ? 'Processing...' : 'Proceed to Payment'}
              </button>
            </div>
          </form>
        ) : (
          <div className="mt-6 space-y-4">
            {activePayment.provider === 'manual' ? (
              <div className="rounded-xl border border-blue-100 bg-blue-50/50 p-4 dark:border-blue-900/50 dark:bg-blue-950/20">
                <h4 className="font-semibold text-blue-900 dark:text-blue-300">Bank Transfer Instructions</h4>
                <div className="mt-2 whitespace-pre-wrap text-sm text-slate-700 dark:text-slate-300">
                  {activePayment.instructions ||
                    'Please transfer funds to our designated corporate account and reference your invoice number.'}
                </div>
                <div className="mt-3 text-xs text-slate-500">
                  Payment Reference ID: <span className="font-mono">{activePayment.id}</span>
                </div>
              </div>
            ) : (
              <div className="rounded-xl border border-green-100 bg-green-50/50 p-4 dark:border-green-900/50 dark:bg-green-950/20">
                <h4 className="font-semibold text-green-900 dark:text-green-300">Sandbox Payment Initiated</h4>
                <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
                  Provider Reference: <span className="font-mono">{activePayment.providerReference}</span>
                </p>
                <div className="mt-3 text-xs text-green-700 dark:text-green-400">
                  Status: {activePayment.status.toUpperCase()}
                </div>
              </div>
            )}

            <div className="mt-6 flex justify-end">
              <button
                type="button"
                onClick={onClose}
                className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white"
              >
                Done
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
