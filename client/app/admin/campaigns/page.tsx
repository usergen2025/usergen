'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { apiClient } from '@/lib/api/client';

interface CampaignRow {
  id: string;
  name: string;
  brandId?: string;
  status: string;
  totalBudget: number;
  budgetUsed: number;
}

interface ApplicationRow {
  id: string;
  creatorId: string;
  status: string;
  draftMediaUrl?: string;
}

interface PostSubmissionRow {
  id: string;
  creatorId: string;
  status: string;
  postUrl: string;
}

interface CreatorEarningRow {
  id: string;
  creatorId: string;
  status: string;
  amount: number;
  unlockAt: string;
}

export default function AdminCampaignsPage() {
  const [campaigns, setCampaigns] = useState<CampaignRow[]>([]);
  const [selectedCampaignId, setSelectedCampaignId] = useState<string>('');
  const [applications, setApplications] = useState<ApplicationRow[]>([]);
  const [submissions, setSubmissions] = useState<Array<{ id: string; creatorId?: string; status: string }>>([]);
  const [postSubmissions, setPostSubmissions] = useState<PostSubmissionRow[]>([]);
  const [creatorEarnings, setCreatorEarnings] = useState<CreatorEarningRow[]>([]);
  const [viewInputs, setViewInputs] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const selectedCampaign = useMemo(
    () => campaigns.find((campaign) => campaign.id === selectedCampaignId),
    [campaigns, selectedCampaignId],
  );

  const loadCampaigns = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await apiClient.getCampaigns();
      const rows = (response.data || []) as CampaignRow[];
      setCampaigns(rows);
      if (!selectedCampaignId && rows.length > 0) {
        setSelectedCampaignId(rows[0].id);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load campaigns');
    } finally {
      setLoading(false);
    }
  }, [selectedCampaignId]);

  const loadCampaignDetails = useCallback(async (campaignId: string) => {
    if (!campaignId) return;
    try {
      const [applicationsRes, submissionsRes, postSubmissionsRes] = await Promise.all([
        apiClient.getCampaignApplications(campaignId),
        apiClient.getCampaignApplicants(campaignId),
        apiClient.getCampaignPostSubmissions(campaignId),
      ]);
      setApplications(applicationsRes.data || []);
      setSubmissions(submissionsRes.data || []);
      setPostSubmissions(postSubmissionsRes.data || []);
      const earningsRes = await apiClient.getCampaignCreatorEarnings(campaignId);
      setCreatorEarnings((earningsRes.data || []) as CreatorEarningRow[]);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load campaign details');
    }
  }, []);

  useEffect(() => {
    let active = true;
    const run = async () => {
      if (!active) return;
      await loadCampaigns();
    };
    void run();
    return () => {
      active = false;
    };
  }, [loadCampaigns]);

  useEffect(() => {
    if (!selectedCampaignId) return;
    void loadCampaignDetails(selectedCampaignId);
  }, [selectedCampaignId, loadCampaignDetails]);

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white">Campaign Moderation</h1>
        <p className="mt-1 text-sm text-gray-400">
          Review applications, draft submissions, and final post verifications across all brands.
        </p>
      </div>

      {loading ? (
        <div className="rounded-xl border border-gray-700 bg-gray-800 p-6 text-gray-300">Loading campaigns...</div>
      ) : error ? (
        <div className="rounded-xl border border-red-500/50 bg-red-900/20 p-6 text-red-300">{error}</div>
      ) : (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[320px_1fr]">
          <div className="rounded-xl border border-gray-700 bg-gray-800 p-3">
            <h2 className="mb-3 text-sm font-semibold text-white">All campaigns</h2>
            <div className="max-h-[70dvh] space-y-2 overflow-y-auto pr-1">
              {campaigns.map((campaign) => {
                const selected = campaign.id === selectedCampaignId;
                return (
                  <button
                    key={campaign.id}
                    type="button"
                    onClick={() => setSelectedCampaignId(campaign.id)}
                    className={`w-full rounded-lg border p-3 text-left transition-colors ${
                      selected
                        ? 'border-orange-500/60 bg-orange-500/10'
                        : 'border-gray-700 bg-gray-900/40 hover:border-gray-600'
                    }`}
                  >
                    <p className="truncate text-sm font-medium text-white">{campaign.name}</p>
                    <p className="mt-1 text-xs text-gray-400">
                      {campaign.status} · ₹{Number(campaign.budgetUsed).toLocaleString('en-IN')} / ₹
                      {Number(campaign.totalBudget).toLocaleString('en-IN')}
                    </p>
                    <p className="mt-1 text-[11px] text-gray-500">Brand: {campaign.brandId || '—'}</p>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="space-y-4">
            <div className="rounded-xl border border-gray-700 bg-gray-800 p-4">
              <h2 className="text-base font-semibold text-white">
                {selectedCampaign ? selectedCampaign.name : 'Select a campaign'}
              </h2>
              <p className="mt-1 text-xs text-gray-400">
                Applications: {applications.length} · Draft submissions: {submissions.length} · Final posts:{' '}
                {postSubmissions.length}
              </p>
            </div>

            <div className="rounded-xl border border-gray-700 bg-gray-800 p-4">
              <h3 className="mb-2 text-sm font-semibold text-white">Applications</h3>
              <div className="space-y-2">
                {applications.length === 0 ? (
                  <p className="text-xs text-gray-400">No applications.</p>
                ) : (
                  applications.map((application) => (
                    <div key={application.id} className="rounded-md border border-gray-700 bg-gray-900/30 p-2 text-xs text-gray-200">
                      <p>{application.creatorId} · {application.status}</p>
                      {application.draftMediaUrl ? (
                        <a href={application.draftMediaUrl} target="_blank" rel="noopener noreferrer" className="text-blue-300 hover:underline">
                          Open draft media
                        </a>
                      ) : null}
                      {application.status === 'APPLIED' || application.status === 'SUBMITTED' ? (
                        <div className="mt-2 flex gap-2">
                          <button
                            type="button"
                            className="rounded bg-emerald-600 px-2 py-1 text-[11px] font-medium text-white hover:bg-emerald-500"
                            onClick={async () => {
                              try {
                                await apiClient.reviewApplication(application.id, { status: 'APPROVED' });
                                await loadCampaignDetails(selectedCampaignId);
                              } catch (err: unknown) {
                                setError(err instanceof Error ? err.message : 'Failed to approve application');
                              }
                            }}
                          >
                            Approve
                          </button>
                          <button
                            type="button"
                            className="rounded bg-rose-600 px-2 py-1 text-[11px] font-medium text-white hover:bg-rose-500"
                            onClick={async () => {
                              try {
                                await apiClient.reviewApplication(application.id, { status: 'REJECTED' });
                                await loadCampaignDetails(selectedCampaignId);
                              } catch (err: unknown) {
                                setError(err instanceof Error ? err.message : 'Failed to reject application');
                              }
                            }}
                          >
                            Reject
                          </button>
                        </div>
                      ) : null}
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="rounded-xl border border-gray-700 bg-gray-800 p-4">
              <h3 className="mb-2 text-sm font-semibold text-white">Final Post Submissions</h3>
              <div className="space-y-2">
                {postSubmissions.length === 0 ? (
                  <p className="text-xs text-gray-400">No final post links.</p>
                ) : (
                  postSubmissions.map((submission) => (
                    <div key={submission.id} className="rounded-md border border-gray-700 bg-gray-900/30 p-2 text-xs text-gray-200">
                      <p>{submission.creatorId} · {submission.status}</p>
                      <a
                        href={submission.postUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-300 hover:underline"
                      >
                        {submission.postUrl}
                      </a>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {submission.status === 'PENDING_REVIEW' ? (
                          <>
                            <button
                              type="button"
                              className="rounded bg-emerald-600 px-2 py-1 text-[11px] font-medium text-white hover:bg-emerald-500"
                              onClick={async () => {
                                try {
                                  await apiClient.reviewPostSubmission(submission.id, { status: 'VERIFIED' });
                                  await loadCampaignDetails(selectedCampaignId);
                                } catch (err: unknown) {
                                  setError(err instanceof Error ? err.message : 'Failed to verify post');
                                }
                              }}
                            >
                              Verify
                            </button>
                            <button
                              type="button"
                              className="rounded bg-rose-600 px-2 py-1 text-[11px] font-medium text-white hover:bg-rose-500"
                              onClick={async () => {
                                try {
                                  await apiClient.reviewPostSubmission(submission.id, { status: 'REJECTED' });
                                  await loadCampaignDetails(selectedCampaignId);
                                } catch (err: unknown) {
                                  setError(err instanceof Error ? err.message : 'Failed to reject post');
                                }
                              }}
                            >
                              Reject
                            </button>
                          </>
                        ) : null}
                        {submission.status === 'VERIFIED' ? (
                          <>
                            <input
                              value={viewInputs[submission.id] || ''}
                              onChange={(event) =>
                                setViewInputs((prev) => ({ ...prev, [submission.id]: event.target.value.replace(/[^0-9]/g, '') }))
                              }
                              placeholder="Current views"
                              className="rounded border border-gray-600 bg-gray-950 px-2 py-1 text-[11px] text-white"
                            />
                            <button
                              type="button"
                              className="rounded bg-orange-600 px-2 py-1 text-[11px] font-medium text-white hover:bg-orange-500"
                              onClick={async () => {
                                const currentViews = Number(viewInputs[submission.id] || 0);
                                try {
                                  await apiClient.verifyPostViews(submission.id, { currentViews });
                                  await loadCampaignDetails(selectedCampaignId);
                                } catch (err: unknown) {
                                  setError(err instanceof Error ? err.message : 'Failed to update views');
                                }
                              }}
                            >
                              Update views
                            </button>
                          </>
                        ) : null}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="rounded-xl border border-gray-700 bg-gray-800 p-4">
              <div className="mb-2 flex items-center justify-between">
                <h3 className="text-sm font-semibold text-white">Creator Earnings (Lock Window)</h3>
                <button
                  type="button"
                  className="rounded bg-orange-600 px-2 py-1 text-[11px] font-medium text-white hover:bg-orange-500"
                  onClick={async () => {
                    try {
                      await apiClient.processLockedEarningsUnlock();
                      await loadCampaignDetails(selectedCampaignId);
                    } catch (err: unknown) {
                      setError(err instanceof Error ? err.message : 'Failed to process unlock');
                    }
                  }}
                >
                  Process unlocks
                </button>
              </div>
              <div className="space-y-2">
                {creatorEarnings.length === 0 ? (
                  <p className="text-xs text-gray-400">No earnings yet.</p>
                ) : (
                  creatorEarnings.map((earning) => (
                    <div key={earning.id} className="rounded-md border border-gray-700 bg-gray-900/30 p-2 text-xs text-gray-200">
                      <p>
                        {earning.creatorId} · ₹{Number(earning.amount).toLocaleString('en-IN')} · {earning.status}
                      </p>
                      <p className="mt-1 text-[11px] text-gray-400">Unlock: {new Date(earning.unlockAt).toLocaleString()}</p>
                      {earning.status === 'LOCKED' ? (
                        <button
                          type="button"
                          className="mt-2 rounded bg-rose-600 px-2 py-1 text-[11px] font-medium text-white hover:bg-rose-500"
                          onClick={async () => {
                            try {
                              await apiClient.reverseLockedEarning(earning.id, 'Admin moderation reversal');
                              await loadCampaignDetails(selectedCampaignId);
                            } catch (err: unknown) {
                              setError(err instanceof Error ? err.message : 'Failed to reverse earning');
                            }
                          }}
                        >
                          Reverse locked earning
                        </button>
                      ) : null}
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
