/**
 * Every string on the public landing page.
 *
 * Kept out of the components so copy can be revised without touching layout,
 * and so the strings the design has not settled yet are visible in one place —
 * search `TODO(copy)` for anything that must be confirmed before launch.
 *
 * The 1280px and 390px frames do not always say the same thing: mobile
 * shortens several paragraphs and drops a language pill. Where that is
 * deliberate the value is a `{ base, mobile }` pair; where the frames agree it
 * is a plain string. Nothing here decides which one renders — see
 * `components/marketing/ResponsiveCopy.tsx`, which emits both and lets CSS
 * choose, because picking in JS would mean either a hydration mismatch or
 * shipping a client-only page.
 */

/** A value the mobile frame overrides, or a plain value used at every width. */
export type Responsive<T> = T | { base: T; mobile: T };

export function isResponsive<T>(value: Responsive<T>): value is { base: T; mobile: T } {
  return typeof value === 'object' && value !== null && 'base' in value && 'mobile' in value;
}

/** The value for >=768px, and the only value when the frames agree. */
export function baseValue<T>(value: Responsive<T>): T {
  return isResponsive(value) ? value.base : value;
}

/** The value for <768px. */
export function mobileValue<T>(value: Responsive<T>): T {
  return isResponsive(value) ? value.mobile : value;
}

export type NavLink = { label: string; href: string };

export type LandingContent = {
  nav: {
    links: NavLink[];
    login: string;
    openMenu: string;
    closeMenu: string;
  };
  hero: {
    eyebrow: string;
    headline: { lead: string; priceLine: string; price: string };
    subcopy: Responsive<string>;
    widget: {
      tabs: { link: Responsive<string>; brief: Responsive<string> };
      linkPlaceholder: string;
      briefPlaceholder: string;
      avatarOptions: [string, string];
      languages: Responsive<string[]>;
      submit: string;
    };
    assurances: string[];
  };
  reel: {
    eyebrow: string;
    headline: { lead: string; trail: string };
    items: { title: string; caption: string }[];
    footnote: Responsive<string>;
  };
  avatars: {
    eyebrow: string;
    headline: { lead: string; trail: string };
    subcopy: Responsive<string>;
    features: { title: Responsive<string>; body: Responsive<string> }[];
    proof: string;
    cta: string;
  };
  howItWorks: {
    eyebrow: string;
    headline: { lead: string; trail: string };
    steps: { label: string; title: string; body: string }[];
  };
  translation: {
    eyebrow: string;
    headline: { lead: string; trail: string };
    subcopy: string;
    cta: string;
    languages: string[];
    /** Clarifies which of `languages` are generated vs translated afterwards. */
    languagesNote: string;
    sample: { name: string; language: string };
    features: Responsive<string>[];
  };
  costComparison: {
    eyebrow: string;
    headline: { lead: string; trail: string };
    columns: { option: string; cost: string; revisions: string; turnaround: string };
    rows: {
      option: string;
      cost: string;
      revisions: string;
      turnaround: string;
      highlight?: boolean;
    }[];
    footnote: string;
  };
  pricing: {
    eyebrow: string;
    headline: { lead: string; trail: string };
    popularBadge: string;
    plans: {
      name: string;
      price: string;
      priceSuffix: Responsive<string>;
      note?: string;
      features: string[];
      cta: string;
      popular?: boolean;
      /** Plan sold by conversation, not self-serve — routes to sales, not sign-up. */
      contact?: boolean;
    }[];
    payment: { label: string; methods: string[]; assurance: string };
  };
  faq: {
    eyebrow: string;
    headline: { lead: string; trail: string };
    items: { question: string; answer: Responsive<string> }[];
    viewAll: string;
  };
  bottomCta: {
    headline: { lead: string; trail: string };
    subcopy: Responsive<string>;
    primary: string;
    whatsapp: Responsive<string>;
  };
  footer: {
    wordmark: string;
    links: NavLink[];
    social: { label: string; href: string; icon: 'discord' | 'youtube' | 'twitter' | 'linkedin' | 'instagram' }[];
    copyright: string;
  };
};

/**
 * The three pages the nav links at, which the design does not cover.
 *
 * TODO(copy): all of this is written to fill the routes the header already
 * advertises — the Figma file has a landing frame and nothing else. Each page
 * is assembled from landing sections under one of these intros, so the copy
 * below is the only thing marketing has to replace when the frames land.
 */
export type SubPageIntro = {
  /** Feeds `<title>` and the OG title; the visible heading is `headline`. */
  metaTitle: string;
  metaDescription: string;
  eyebrow: string;
  headline: { lead: string; trail: string };
  subcopy: string;
};

export const subPages = {
  pricing: {
    metaTitle: 'Pricing',
    metaDescription:
      'Pay ₹350 per finished video ad, or bundle a month of them. No retainer, no agency minimum, no lock-in.',
    eyebrow: 'Pricing',
    headline: { lead: 'Pay for videos,', trail: 'not for retainers' },
    subcopy:
      'One flat price per finished ad. Bundle a month of them if you ship often, or talk to us if you need volume.',
  },
  examples: {
    metaTitle: 'Examples',
    metaDescription:
      'Real video ads generated with UserGen.ai — product reels, avatar explainers and translated cuts across Indian languages.',
    eyebrow: 'Examples',
    headline: { lead: 'Ads made on UserGen,', trail: 'start to finish' },
    subcopy:
      'Every video here came out of the same flow you get: a product link or a short brief in, a finished cut out.',
  },
  agencies: {
    metaTitle: 'For Agencies',
    metaDescription:
      'Produce client video ads at volume without growing your edit bay. Flat per-video pricing, same-day turnaround, unlimited revisions.',
    eyebrow: 'For agencies',
    headline: { lead: 'Ship client work', trail: 'without growing the edit bay' },
    subcopy:
      'Take on more retainers without hiring editors. Same-day turnaround, unlimited revisions, and a cost per video you can mark up.',
  },
} satisfies Record<string, SubPageIntro>;

/**
 * WhatsApp support handle behind the secondary CTA.
 * TODO(copy): the design shows the button but no number — confirm the business
 * account before launch. Until then the CTA is hidden rather than pointing at
 * a wa.me link that resolves to nobody.
 */
export const WHATSAPP_NUMBER: string | null = null;

/**
 * Where "Book a call with our team" and "Talk to us" point.
 *
 * TODO(copy): no sales address has been confirmed, and there is no lead
 * capture anywhere in the backend — no contact endpoint, no CRM. Until one of
 * the two exists these CTAs fall back to sign-up, which is the only record of
 * an interested visitor the system can actually keep. Setting this to a real
 * address turns them into mailto links with no other change.
 */
export const SALES_EMAIL: string | null = null;

export const landing = {
  nav: {
    links: [
      { label: 'Examples', href: '/examples' },
      { label: 'Pricing', href: '/pricing' },
      { label: 'For Agencies', href: '/agencies' },
    ],
    login: 'Log in',
    openMenu: 'Open menu',
    closeMenu: 'Close menu',
  },

  hero: {
    eyebrow: 'AI video ads for Indian businesses',
    // Split so the rupee figure can take the gradient fill and the price font.
    headline: { lead: 'One video ad,', priceLine: 'only for', price: '₹350' },
    subcopy: {
      base: 'No agency. No editor. No waiting. Paste your product link or describe your ad, and get a fully edited video in minutes.',
      mobile: 'No agency. No editor. No waiting. Paste your product link and get a fully edited video in minutes.',
    },
    widget: {
      tabs: {
        link: { base: 'Paste product link', mobile: 'Paste link' },
        brief: { base: 'Describe your ad', mobile: 'Describe ad' },
      },
      linkPlaceholder: 'https://yourstore.in/product/vitamin-c-serum',
      // TODO(copy): the brief tab is shown empty in both frames.
      briefPlaceholder: 'A 20-second ad for my vitamin C serum, upbeat and friendly',
      avatarOptions: ['With avatar', 'Without avatar'],
      // The mobile frame drops Hinglish to keep the row on one line.
      languages: { base: ['Hindi', 'English', 'Hinglish'], mobile: ['Hindi', 'English'] },
      submit: 'Generate my ad',
    },
    assurances: [
      'Ready in minutes',
      'Fully edited with captions & music',
      'Reels, Shorts & Meta ad sizes',
    ],
  },

  reel: {
    eyebrow: 'Real outputs',
    headline: { lead: 'Made on UserGen.', trail: 'No crew, no studio.' },
    items: [
      { title: 'D2C Skincare', caption: 'With avatar' },
      { title: 'Real Estate', caption: 'With avatar' },
      { title: 'Restaurant', caption: 'With avatar' },
      { title: 'Coaching Institute', caption: 'With avatar' },
      { title: 'Clinic / Dental', caption: 'With avatar' },
      { title: 'Jewellery', caption: 'With avatar' },
    ],
    footnote: {
      base: 'Tap any video to play with sound. Every one was generated from a single link or brief.',
      mobile: 'Tap any video to play. Generated from a single link or brief.',
    },
  },

  avatars: {
    eyebrow: 'AI Avatars Generator',
    headline: { lead: 'The most life-like', trail: 'avatars in AI video' },
    subcopy: {
      base: 'Character consistency is what separates a truly useful avatar from a mere gimmick. Avatar V delivers this across every angle, every expression, and every video you create.',
      mobile: 'Character consistency separates a truly useful avatar from a mere gimmick. Avatar V delivers this across every expression you create.',
    },
    features: [
      {
        title: 'Character consistency',
        body: {
          base: 'Avatar V maintains a single, coherent identity across every video you create. The same face, the same micro-expressions, the same presence across a 30-second clip or a 10-minute course module. No drift. No artefacts. No uncanny valley.',
          mobile: 'Avatar V maintains a single, coherent identity across every video. No face-drift or uncanny valley artifacts.',
        },
      },
      {
        title: 'Multiple viewpoints',
        body: {
          base: 'Wide shots, medium frames, and close-ups, all consistent, all from one recording. Angles that allow a single avatar to work seamlessly across every format.',
          mobile: 'Wide shots, medium frames, and close-ups, all consistent and generated seamlessly from a single rendering.',
        },
      },
      {
        title: 'Accurate lip-syncing',
        body: {
          base: 'Phoneme-level accuracy across every supported language. What you hear and what you see stay perfectly in sync at any speed, in 175+ languages and dialects.',
          mobile: 'Phoneme-level accuracy across 175+ languages. What you hear stays perfectly in sync with the speaker.',
        },
      },
      {
        title: 'Emotions synced',
        body: {
          base: 'Fluid upper-body motion, responsive gestures, and consistent movement across scene changes. The difference between an avatar that simply presents and one that truly performs.',
          mobile: 'Fluid upper-body motion, responsive gestures, and consistent movement across scene changes.',
        },
      },
    ],
    /*
     * TODO(copy): this is HeyGen's marketing claim, carried over verbatim in
     * the design. "Rated #1", a review count and a Fortune 100 statistic are
     * all falsifiable and none of them are ours — legal and marketing need to
     * replace or drop this line before launch.
     */
    proof: 'Rated #1 most realistic. 1,000+ reviews. Trusted by 85% of Fortune 100 companies',
    cta: 'Get started now',
  },

  howItWorks: {
    eyebrow: 'How it works',
    headline: { lead: 'Link to finished ad', trail: 'in three steps' },
    steps: [
      {
        label: 'Step 1',
        title: 'Paste your link or brief',
        body: 'Drop your product URL, or type what you want in Hindi or English. We pull the details automatically.',
      },
      {
        label: 'Step 2',
        title: 'Pick your avatar, or skip it',
        body: 'Choose a presenter and voice, or go avatar-free with product-only visuals. Your ad, your call.',
      },
      {
        label: 'Step 3',
        title: 'Download your edited ad',
        body: 'Script, voiceover, captions, music and cuts, all done. Sized for Reels, Shorts and Meta ads.',
      },
    ],
  },

  translation: {
    eyebrow: 'Video Translation',
    headline: { lead: 'The most life-like', trail: 'Indian faces, accents, & language.' },
    subcopy: 'Presenters your customers actually relate to, speaking the way your market speaks.',
    cta: 'Get started now',
    /*
     * The first three are the only ones a script can be written in — they are
     * the `english | hindi | hinglish` the generator accepts, and the design
     * already shows exactly those three as selected. The rest are reached by
     * translating a finished video, so the note below says so rather than
     * letting the row imply you can generate in Tamil from the start.
     */
    languages: ['Hindi', 'English', 'Hinglish', 'Tamil', 'Telugu', 'Marathi', 'Bengali', '+ more'],
    languagesNote: 'Write your ad in Hindi, English or Hinglish — then translate the finished video into the rest.',
    sample: { name: 'Priya', language: 'Hindi' },
    features: [
      'Effortless video translation',
      { base: 'Perfect lip-synchronisation', mobile: 'Perfect lip-synch' },
      'Designed for global scale',
    ],
  },

  costComparison: {
    /*
     * TODO(copy): the 1280px frame labels this section "How it works", which
     * is the previous section's badge left in place — the 390px frame says
     * "Pricing". Using "Pricing" as the evidently intended label.
     */
    eyebrow: 'Pricing',
    headline: { lead: 'What a video ad', trail: 'actually costs in India' },
    columns: {
      option: 'Option',
      cost: 'Cost per ad',
      revisions: 'Revisions',
      turnaround: 'Turnaround',
    },
    rows: [
      {
        option: 'Ad agency',
        cost: '₹15,000 – ₹50,000',
        revisions: '2, then billed extra',
        turnaround: '2 – 3 weeks',
      },
      {
        option: 'Freelance editor',
        cost: '₹3,000 – ₹8,000',
        revisions: 'Depends on their mood',
        turnaround: '4 – 5 days',
      },
      {
        option: 'UserGen.ai',
        cost: '₹350',
        revisions: 'Regenerate anytime',
        turnaround: 'Minutes*',
        highlight: true,
      },
    ],
    footnote: 'Competitor costs are an average and do not signify the actual numbers.',
  },

  pricing: {
    eyebrow: 'Pricing',
    headline: { lead: 'Simple pricing,', trail: 'no hidden charges' },
    popularBadge: 'Most popular',
    plans: [
      {
        name: 'Pay As You Go',
        price: '₹350',
        priceSuffix: { base: 'per video', mobile: '/ video' },
        features: [
          '1 fully edited video ad',
          'With or without avatar',
          'All sizes: Reels, Shorts, Meta',
          'Pay only when you need it',
        ],
        cta: 'Generate your first ad',
      },
      {
        name: 'Monthly',
        price: '₹3,000',
        priceSuffix: { base: 'for 10 videos every month', mobile: '/ 10 videos a month' },
        note: 'Save ₹500 | pay as you go',
        features: [
          '10 fully edited video ads',
          'All avatars & languages',
          'Priority generation queue',
          'GST invoice included',
        ],
        cta: 'Start monthly plan',
        popular: true,
      },
      {
        name: 'Custom Project',
        price: "Let's talk",
        priceSuffix: 'for brands & agencies',
        features: [
          'Bulk video volumes',
          'Custom avatars of your team',
          'Brand kit & dedicated support',
          'White-label options',
        ],
        cta: 'Book a call with our team',
        contact: true,
      },
    ],
    payment: {
      label: 'Pay securely with',
      methods: ['UPI', 'Razorpay', 'Cards', 'Net Banking'],
      assurance: 'GST invoice on every plan',
    },
  },

  faq: {
    eyebrow: 'FAQ',
    headline: { lead: 'Frequently Asked', trail: 'Questions' },
    items: [
      {
        question: 'What are AI video generators?',
        answer: {
          base: 'AI video generators are AI-powered tools that create videos from a text prompt, text and images, or scripts. These AI tools work like an intelligent video editor, turning prompts into impressive, impactful, and realistic AI videos or video clips without requiring advanced video editing skills.',
          mobile: 'AI tools that convert product links or descriptions into complete video ads with custom avatars, script narration, background scores, and visual templates.',
        },
      },
      {
        question: 'How to create an AI video of yourself?',
        answer: {
          base: 'Upload a short clip or reference image, then type your script. The platform will generate a video with realistic AI motion and voice. You can animate, adjust the format, and create explainer videos or social clips with AI-powered editing tools.',
          mobile: 'Upload a short clip or reference image, then type your script. The platform will generate a video with realistic AI motion and voice.',
        },
      },
      {
        question: 'Can I customize the avatars?',
        answer:
          'Yes, you can choose from dozens of high fidelity Indian presenters with various accents, regions, and styles, or use pure product assets.',
      },
    ],
    viewAll: 'View all',
  },

  bottomCta: {
    headline: { lead: 'Less talking more action,', trail: 'generate your first video now' },
    /*
     * TODO(copy): the 1280px frame repeats the avatar section's paragraph
     * here, which reads as filler left in the file rather than a decision, so
     * the 390px line is used at both widths until marketing supplies one.
     */
    subcopy: 'Create stunning and high converting video ads in minutes, optimized for social platforms.',
    primary: 'Generate your first ad',
    whatsapp: { base: 'Chat with us on WhatsApp', mobile: 'Chat on WhatsApp' },
  },

  footer: {
    wordmark: 'UserGen.ai',
    /*
     * The design also lists Refund Policy, Contact and Terms. Those routes do
     * not exist, and a footer link to a 404 is worse than a shorter footer,
     * so they are held back rather than shipped broken.
     *
     * TODO(launch): all three have to return before payments go live — the
     * pricing CTAs currently stop at sign-up, but Razorpay onboarding
     * requires published terms and a refund policy, and neither can be
     * written here.
     */
    links: [
      { label: 'Pricing', href: '/pricing' },
      { label: 'Examples', href: '/examples' },
    ],
    // TODO(copy): the design shows five icons but no destinations.
    social: [
      { label: 'Discord', href: '#', icon: 'discord' },
      { label: 'YouTube', href: '#', icon: 'youtube' },
      { label: 'X', href: '#', icon: 'twitter' },
      { label: 'LinkedIn', href: '#', icon: 'linkedin' },
      { label: 'Instagram', href: '#', icon: 'instagram' },
    ],
    copyright: '© UserGen.ai · Made in India 🇮🇳',
  },
} satisfies LandingContent;
