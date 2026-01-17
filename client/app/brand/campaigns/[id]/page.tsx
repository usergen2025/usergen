'use client';

import { useState, useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';
import Link from 'next/link';
import Button from '@/components/ui/Button';
import Modal from '@/components/ui/Modal';
import { useToast } from '@/lib/toast/toast';
import { cn } from '@/lib/utils/cn';
import { ArrowLeft, Calendar, Eye, IndianRupee, Users, Edit, ExternalLink, Trash2, Check, X } from 'lucide-react';

const DUMMY_CAMPAIGNS_KEY = 'dummy_campaigns';
const DUMMY_APPLICANTS_KEY = 'dummy_applicants';

interface Applicant {
  id: string;
  name: string;
  age: number;
  gender: string;
  instagramProfileLink: string;
  location: string;
  followers: number;
  appliedAt: string;
  status: 'PENDING' | 'SHORTLISTED' | 'APPROVED' | 'REJECTED';
  views?: number;
  earnings?: number;
}

export default function CampaignDetailsPage() {
  const router = useRouter();
  const params = useParams();
  const { showToast } = useToast();
  const campaignId = params.id as string;
  
  const [campaign, setCampaign] = useState<any>(null);
  const [applicants, setApplicants] = useState<Applicant[]>([]);
  const [shortlisted, setShortlisted] = useState<Applicant[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showShortlistConfirm, setShowShortlistConfirm] = useState(false);
  const [selectedApplicant, setSelectedApplicant] = useState<Applicant | null>(null);

  useEffect(() => {
    if (campaignId) {
      loadCampaign();
      loadApplicants();
    }
  }, [campaignId]);

  const loadCampaign = () => {
    try {
      // Load campaign from localStorage
      if (typeof window !== 'undefined') {
        const stored = localStorage.getItem(DUMMY_CAMPAIGNS_KEY);
        if (stored) {
          const campaigns: any[] = JSON.parse(stored);
          const foundCampaign = campaigns.find(c => c.id === campaignId);
          if (foundCampaign) {
            setCampaign(foundCampaign);
            setIsLoading(false);
            return;
          }
        }
      }
      
      // If not found, show error
      showToast('Campaign not found', 'error');
      router.push('/brand/campaigns');
    } catch (error: any) {
      showToast(error.message || 'Failed to load campaign', 'error');
      setIsLoading(false);
    }
  };

  const loadApplicants = () => {
    try {
      // Load applicants from localStorage
      if (typeof window !== 'undefined') {
        const stored = localStorage.getItem(`${DUMMY_APPLICANTS_KEY}_${campaignId}`);
        if (stored) {
          const allApplicants: Applicant[] = JSON.parse(stored);
          setApplicants(allApplicants.filter((a: Applicant) => a.status === 'PENDING'));
          setShortlisted(allApplicants.filter((a: Applicant) => a.status === 'SHORTLISTED' || a.status === 'APPROVED'));
        } else {
          // Initialize with some dummy applicants
          const dummyApplicants: Applicant[] = [
            {
              id: 'app_1',
              name: 'Sarah Johnson',
              age: 24,
              gender: 'Female',
              instagramProfileLink: 'https://instagram.com/sarahj',
              location: 'Mumbai, India',
              followers: 45000,
              appliedAt: new Date().toISOString(),
              status: 'PENDING',
            },
            {
              id: 'app_2',
              name: 'Mike Chen',
              age: 28,
              gender: 'Male',
              instagramProfileLink: 'https://instagram.com/mikechen',
              location: 'Delhi, India',
              followers: 62000,
              appliedAt: new Date().toISOString(),
              status: 'PENDING',
            },
          ];
          localStorage.setItem(`${DUMMY_APPLICANTS_KEY}_${campaignId}`, JSON.stringify(dummyApplicants));
          setApplicants(dummyApplicants.filter((a: Applicant) => a.status === 'PENDING'));
          setShortlisted([]);
        }
      }
    } catch (error: any) {
      showToast(error.message || 'Failed to load applicants', 'error');
    }
  };

  const handleShortlist = async (applicant: Applicant) => {
    setSelectedApplicant(applicant);
    setShowShortlistConfirm(true);
  };

  const confirmShortlist = () => {
    if (!selectedApplicant) return;
    
    try {
      // Update applicant status in localStorage
      if (typeof window !== 'undefined') {
        const stored = localStorage.getItem(`${DUMMY_APPLICANTS_KEY}_${campaignId}`);
        if (stored) {
          const allApplicants: Applicant[] = JSON.parse(stored);
          const updatedApplicants = allApplicants.map(a => 
            a.id === selectedApplicant.id ? { ...a, status: 'SHORTLISTED' as const } : a
          );
          localStorage.setItem(`${DUMMY_APPLICANTS_KEY}_${campaignId}`, JSON.stringify(updatedApplicants));
          loadApplicants();
          showToast('Applicant shortlisted successfully', 'success');
        }
      }
      setShowShortlistConfirm(false);
      setSelectedApplicant(null);
    } catch (error: any) {
      showToast(error.message || 'Failed to shortlist applicant', 'error');
    }
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  };

  const getDaysRemaining = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diff = Math.ceil((date.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    return diff;
  };

  if (isLoading || !campaign) {
    return (
      <div className="max-w-[1248px] mx-auto px-3 sm:px-6 md:px-[96px] py-8">
        <p className="text-center text-text-secondary">Loading campaign details...</p>
      </div>
    );
  }

  const daysRemaining = getDaysRemaining(campaign.deadlineToApply);
  const budgetProgress = (campaign.budgetUsed / campaign.totalBudget) * 100;
  const viewsProgress = (campaign.views / campaign.targetViews) * 100;

  return (
    <div className="max-w-[1248px] mx-auto px-3 sm:px-6 md:px-[96px]">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-start md:justify-between mb-4 sm:mb-6 md:mb-8 gap-4">
        <div className="flex-1">
          <div className="flex items-center gap-2 sm:gap-4 mb-4">
            <Link href="/brand/campaigns" className="p-2 hover:bg-gray-100 rounded-lg transition-colors">
              <ArrowLeft className="w-4 h-4 sm:w-5 sm:h-5 text-black" />
            </Link>
            <div className="flex-1">
              <h1 className="font-heading text-xl sm:text-2xl md:text-3xl font-medium text-black mb-2">
                {campaign.name}
                <ExternalLink className="w-4 h-4 sm:w-5 sm:h-5 inline-block ml-2 text-gray-400" />
              </h1>
              <div className="flex flex-wrap items-center gap-4">
                <span className="px-3 py-1 bg-orange-100 text-orange-700 rounded-lg text-xs font-medium">
                  {campaign.status === 'IN_PROGRESS' ? 'IN PROGRESS' : campaign.status}
                </span>
                <span className="text-sm text-text-secondary">
                  Posted on: {formatDate(campaign.postedAt)}
                </span>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap gap-4 md:gap-6 mb-4">
            <div className="flex items-center gap-2">
              <IndianRupee className="w-4 h-4 text-[#E86512]" />
              <Eye className="w-4 h-4 text-[#E86512]" />
              <span className="text-sm text-black">
                ₹ {campaign.views.toLocaleString()} / {campaign.targetViews.toLocaleString()} views
              </span>
            </div>
            <div className="flex items-center gap-2">
              <Calendar className="w-4 h-4 text-[#E86512]" />
              <span className={cn('text-sm text-black', daysRemaining < 0 && 'text-red-600')}>
                {formatDate(campaign.deadlineToApply)}
                {daysRemaining >= 0 && ` - ${daysRemaining} days to go!`}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <Calendar className="w-4 h-4 text-[#E86512]" />
              <span className="text-sm text-black">
                Campaign Timeline: {formatDate(campaign.startDate)} - {formatDate(campaign.endDate)}
              </span>
            </div>
          </div>

          <p className="text-sm text-text-secondary mb-4">{campaign.description}</p>
        </div>

        <div className="flex gap-2">
          <Button variant="primary" size="md" onClick={() => {}}>
            Pause Campaign
          </Button>
          <Link href={`/brand/campaigns/${campaignId}/edit`}>
            <Button variant="secondary" size="md">
              <Edit className="w-4 h-4 mr-2" />
              Edit
            </Button>
          </Link>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 sm:gap-4 md:gap-6 mb-4 sm:mb-6 md:mb-8">
        <StatCard
          icon={<Eye className="w-5 h-5 text-[#E86512]" />}
          label="Total Views"
          value={campaign.views.toLocaleString()}
        />
        <StatCard
          icon={<IndianRupee className="w-5 h-5 text-[#E86512]" />}
          label="Budget Used"
          value={`₹ ${campaign.budgetUsed.toLocaleString()} / ₹ ${campaign.totalBudget.toLocaleString()}`}
          progress={budgetProgress}
        />
        <StatCard
          icon={<Calendar className="w-5 h-5 text-[#E86512]" />}
          label="Campaign Timeline"
          value={`${Math.floor((new Date().getTime() - new Date(campaign.startDate).getTime()) / (1000 * 60 * 60 * 24))} / ${Math.floor((new Date(campaign.endDate).getTime() - new Date(campaign.startDate).getTime()) / (1000 * 60 * 60 * 24))} days`}
        />
      </div>

      {/* Shortlisted Section */}
      {shortlisted.length > 0 && (
        <div className="bg-white rounded-2xl shadow-card p-4 sm:p-6 md:p-8 mb-4 sm:mb-6">
          <h2 className="font-heading text-lg sm:text-xl md:text-2xl font-medium text-black mb-4 flex items-center gap-2">
            <Check className="w-5 h-5 text-green-600" />
            Shortlisted
          </h2>
          <div className="space-y-4">
            {shortlisted.map((applicant) => (
              <ApplicantCard key={applicant.id} applicant={applicant} onShortlist={handleShortlist} />
            ))}
          </div>
        </div>
      )}

      {/* Applicants Section */}
      <div className="bg-white rounded-2xl shadow-card p-4 sm:p-6 md:p-8">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-heading text-lg sm:text-xl md:text-2xl font-medium text-black flex items-center gap-2">
            <Users className="w-5 h-5 text-[#E86512]" />
            Applicants ({applicants.length})
          </h2>
          <button className="flex items-center gap-2 px-4 py-2 border border-gray-300 rounded-xl text-sm font-medium hover:bg-gray-50 transition-colors">
            Sort
          </button>
        </div>

        {applicants.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-text-secondary">No Applicants yet, check back in some time.</p>
          </div>
        ) : (
          <div className="space-y-4">
            {applicants.map((applicant) => (
              <ApplicantCard key={applicant.id} applicant={applicant} onShortlist={handleShortlist} />
            ))}
          </div>
        )}
      </div>

      {/* Shortlist Confirmation Modal */}
      <Modal
        isOpen={showShortlistConfirm}
        onClose={() => {
          setShowShortlistConfirm(false);
          setSelectedApplicant(null);
        }}
        className="max-w-md"
      >
        <div className="p-6">
          <h3 className="font-heading text-xl font-medium text-black mb-2">
            Are you sure you want to shortlist {selectedApplicant?.name}?
          </h3>
          <p className="text-sm text-text-secondary mb-6">
            This action can't be undone.
          </p>
          <div className="flex gap-3">
            <Button
              variant="secondary"
              size="md"
              onClick={() => {
                setShowShortlistConfirm(false);
                setSelectedApplicant(null);
              }}
              className="flex-1"
            >
              Go Back
            </Button>
            <Button
              variant="primary"
              size="md"
              onClick={confirmShortlist}
              className="flex-1"
            >
              Shortlist
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

function ApplicantCard({ applicant, onShortlist }: { applicant: Applicant; onShortlist: (applicant: Applicant) => void }) {
  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  };

  return (
    <div className="border border-gray-200 rounded-xl p-4 md:p-6 hover:shadow-md transition-shadow">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div className="flex items-start gap-4 flex-1">
          <div className="w-12 h-12 bg-gradient-to-br from-[#E86412] to-[#F12A4C] rounded-full flex items-center justify-center text-white font-heading font-medium text-lg">
            {applicant.name.charAt(0).toUpperCase()}
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-1">
              <h3 className="font-heading text-lg font-medium text-black">{applicant.name}</h3>
              <span className="text-sm text-text-secondary">
                | Applied on: {formatDate(applicant.appliedAt)}
              </span>
            </div>
            <div className="flex flex-wrap gap-4 md:gap-6 text-sm text-text-secondary mb-2">
              <span className="flex items-center gap-1">
                <ExternalLink className="w-4 h-4" />
                {applicant.instagramProfileLink}
              </span>
              <span>{applicant.age} | {applicant.gender}</span>
              <span>{applicant.location}</span>
              <span className="flex items-center gap-1">
                <Users className="w-4 h-4" />
                {applicant.followers.toLocaleString()} Followers
              </span>
            </div>
            {applicant.views !== undefined && applicant.earnings !== undefined && (
              <div className="flex gap-4 text-sm">
                <span className="flex items-center gap-1">
                  <Eye className="w-4 h-4 text-[#E86512]" />
                  {applicant.views.toLocaleString()} views
                </span>
                <span className="flex items-center gap-1">
                  <IndianRupee className="w-4 h-4 text-[#E86512]" />
                  ₹ {applicant.earnings.toLocaleString()}
                </span>
              </div>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <a
            href={applicant.instagramProfileLink}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 text-sm text-blue-600 hover:underline"
          >
            Go to Instagram Profile
            <ExternalLink className="w-4 h-4" />
          </a>
          {applicant.status === 'PENDING' && (
            <Button
              variant="primary"
              size="sm"
              onClick={() => onShortlist(applicant)}
            >
              Shortlist
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

function StatCard({ icon, label, value, progress }: { icon: React.ReactNode; label: string; value: string; progress?: number }) {
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-3 sm:p-4 md:p-6">
      <div className="flex items-center gap-2 sm:gap-3 mb-2">
        {icon}
        <h3 className="font-heading text-xs sm:text-sm font-medium text-text-secondary">{label}</h3>
      </div>
      <p className="font-heading text-lg sm:text-xl md:text-2xl font-medium text-black mb-2">{value}</p>
      {progress !== undefined && (
        <div className="w-full bg-gray-200 rounded-full h-2">
          <div
            className="bg-gradient-to-r from-[#E86412] to-[#F12A4C] h-2 rounded-full transition-all"
            style={{ width: `${Math.min(progress, 100)}%` }}
          />
        </div>
      )}
    </div>
  );
}

