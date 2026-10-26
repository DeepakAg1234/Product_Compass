/**
 * RavenStack Test Document Generator — Setup & Shared Infrastructure
 *
 * This file contains constants, helpers, cleanup, and batch orchestrators.
 * All functions are globally available to batch1-6.gs files.
 *
 * Usage:
 *   1. Create 7 files in Apps Script editor: setup.gs, batch1.gs ... batch6.gs
 *   2. Paste each file's content
 *   3. Run cleanupFolder() first to delete old docs
 *   4. Run runBatch1() through runBatch6() individually
 */

// ═══════════════════════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════════════════════

var FOLDER_NAME = "RavenStack Test Docs";

// Feature name mapping
var FEATURES = {
  feature_1: "Smart Alerts",
  feature_2: "Dashboard Builder",
  feature_3: "Custom Reports",
  feature_4: "Team Spaces",
  feature_5: "AI Summary",
  feature_6: "File Sharing",
  feature_7: "Kanban Board",
  feature_8: "Calendar Sync",
  feature_9: "Guest Access",
  feature_10: "API Webhooks",
  feature_11: "Document Editor",
  feature_12: "Video Conferencing",
  feature_13: "Task Automation",
  feature_14: "Gantt Charts",
  feature_15: "Real-time Chat",
  feature_16: "Resource Planner",
  feature_17: "Time Tracking",
  feature_18: "Workflow Templates",
  feature_19: "AI Agent Builder",
  feature_20: "Data Export",
  feature_21: "SSO Integration",
  feature_22: "Audit Logs",
  feature_23: "Custom Fields",
  feature_24: "Milestone Tracker",
  feature_25: "Budget Tracker",
  feature_26: "Risk Register",
  feature_27: "Stakeholder Map",
  feature_28: "Sprint Planning",
  feature_29: "Dependency Graph",
  feature_30: "Portfolio View",
  feature_31: "OKR Tracker",
  feature_32: "Inbox Zero",
  feature_33: "Meeting Notes",
  feature_34: "Knowledge Base",
  feature_35: "AI Copilot",
  feature_36: "Approval Workflows",
  feature_37: "Client Portal",
  feature_38: "Integrations Hub",
  feature_39: "Notification Center",
  feature_40: "AI Search"
};

var BETA_FEATURES = ["feature_40", "feature_1", "feature_35", "feature_19", "feature_5"];

var INDUSTRIES = ["Cybersecurity", "DevTools", "EdTech", "FinTech", "HealthTech"];
var COUNTRIES = ["US", "UK", "India", "Australia", "Germany", "Canada", "France"];
var TIERS = ["Basic", "Pro", "Enterprise"];
var REFERRAL_SOURCES = ["organic", "ads", "partner", "event", "other"];
var CHURN_REASONS = ["pricing", "support", "budget", "features", "competitor", "unknown"];

// ── MRR by month x tier (2025) ──
var MRR_2025 = [
  ["Month", "Basic", "Pro", "Enterprise", "Total"],
  ["Jan 2025", 20273, 46550, 206363, 273186],
  ["Feb 2025", 16226, 71442, 259695, 347363],
  ["Mar 2025", 22287, 69090, 330539, 421916],
  ["Apr 2025", 30970, 60270, 354618, 445858],
  ["May 2025", 30248, 121716, 480585, 632549],
  ["Jun 2025", 39406, 100352, 398000, 537758],
  ["Jul 2025", 50369, 146216, 511231, 707816],
  ["Aug 2025", 56354, 139944, 452128, 648426],
  ["Sep 2025", 70395, 168756, 753215, 992366],
  ["Oct 2025", 76722, 198401, 898485, 1173608],
  ["Nov 2025", 97299, 241423, 1210318, 1549040],
  ["Dec 2025", 144305, 476427, 1652695, 2273427]
];

// ── MRR by month x tier (2024) ──
var MRR_2024 = [
  ["Month", "Basic", "Pro", "Enterprise", "Total"],
  ["Jan 2024", 171, 931, 3582, 4684],
  ["Feb 2024", 570, 5733, 4776, 11079],
  ["Mar 2024", 1862, 6909, 17114, 25885],
  ["Apr 2024", 4332, 14014, 24079, 42425],
  ["May 2024", 3990, 16219, 65073, 85282],
  ["Jun 2024", 11077, 20237, 44775, 76089],
  ["Jul 2024", 11685, 22932, 86565, 121182],
  ["Aug 2024", 9538, 16513, 150444, 176495],
  ["Sep 2024", 10393, 31801, 61292, 103486],
  ["Oct 2024", 16321, 29449, 148852, 194622],
  ["Nov 2024", 16644, 46060, 151638, 214342],
  ["Dec 2024", 19000, 53704, 207159, 279863]
];

// ── Churn by quarter x reason ──
var CHURN_DATA = [
  ["Quarter", "Pricing", "Support", "Budget", "Features", "Competitor", "Unknown", "Total", "Refunds ($)"],
  ["2024-Q1", 1, 2, 1, 0, 1, 1, 6, 0],
  ["2024-Q2", 3, 1, 3, 2, 1, 1, 11, 38.15],
  ["2024-Q3", 5, 3, 2, 4, 4, 1, 19, 70.81],
  ["2024-Q4", 1, 13, 5, 5, 7, 8, 39, 736.82],
  ["2025-Q1", 11, 7, 7, 13, 6, 8, 52, 603.27],
  ["2025-Q2", 15, 15, 16, 16, 20, 10, 92, 990.30],
  ["2025-Q3", 22, 22, 23, 21, 20, 22, 130, 2502.58],
  ["2025-Q4", 33, 41, 47, 53, 33, 44, 251, 3710.32]
];

// ── Feature usage 2025 (all 40 features, sorted by usage) ──
var FEATURE_USAGE_ALL = [
  ["Inbox Zero", 3606, 312, 165, 352],
  ["Notification Center", 3463, 294, 198, 346],
  ["Integrations Hub", 3457, 286, 181, 340],
  ["Dashboard Builder", 3446, 276, 194, 331],
  ["OKR Tracker", 3429, 264, 171, 343],
  ["File Sharing", 3351, 284, 165, 332],
  ["Approval Workflows", 3319, 259, 194, 339],
  ["Document Editor", 3312, 292, 169, 325],
  ["Data Export", 3306, 268, 172, 326],
  ["Video Conferencing", 3294, 294, 205, 335],
  ["Knowledge Base", 3273, 282, 186, 324],
  ["Sprint Planning", 3263, 283, 184, 322],
  ["Milestone Tracker", 3207, 297, 177, 321],
  ["Real-time Chat", 3202, 263, 163, 308],
  ["Stakeholder Map", 3189, 278, 170, 309],
  ["AI Copilot", 3150, 269, 155, 298],
  ["Custom Reports", 3098, 258, 162, 305],
  ["Team Spaces", 3045, 241, 148, 291],
  ["Task Automation", 2987, 235, 159, 288],
  ["Kanban Board", 2934, 228, 142, 279],
  ["Calendar Sync", 2891, 221, 138, 271],
  ["Guest Access", 2845, 215, 131, 265],
  ["API Webhooks", 2802, 209, 127, 258],
  ["Gantt Charts", 2756, 203, 122, 251],
  ["Resource Planner", 2712, 198, 118, 244],
  ["Time Tracking", 2670, 192, 114, 238],
  ["Workflow Templates", 2625, 187, 110, 231],
  ["Custom Fields", 2580, 181, 106, 224],
  ["Budget Tracker", 2534, 176, 102, 218],
  ["Risk Register", 2489, 170, 98, 211],
  ["Dependency Graph", 2445, 165, 94, 205],
  ["Portfolio View", 2400, 159, 90, 198],
  ["Client Portal", 2356, 154, 86, 192],
  ["Audit Logs", 2312, 148, 82, 185],
  ["SSO Integration", 2267, 142, 78, 178],
  ["Meeting Notes", 2223, 137, 74, 172],
  ["Smart Alerts", 2178, 131, 70, 165],
  ["AI Agent Builder", 2134, 126, 66, 159],
  ["AI Summary", 2089, 120, 62, 152],
  ["AI Search", 2045, 115, 58, 146]
];

// ── Top 20 feature usage (for sheets backward compat) ──
var FEATURE_USAGE_2025 = [
  ["Feature", "Total Uses", "Total Duration (hrs)", "Error Count", "Usage Records"],
  ["Inbox Zero", 3606, 312, 165, 352],
  ["Notification Center", 3463, 294, 198, 346],
  ["Integrations Hub", 3457, 286, 181, 340],
  ["Dashboard Builder", 3446, 276, 194, 331],
  ["OKR Tracker", 3429, 264, 171, 343],
  ["File Sharing", 3351, 284, 165, 332],
  ["Approval Workflows", 3319, 259, 194, 339],
  ["Document Editor", 3312, 292, 169, 325],
  ["Data Export", 3306, 268, 172, 326],
  ["Video Conferencing", 3294, 294, 205, 335],
  ["Knowledge Base", 3273, 282, 186, 324],
  ["Sprint Planning", 3263, 283, 184, 322],
  ["Milestone Tracker", 3207, 297, 177, 321],
  ["Real-time Chat", 3202, 263, 163, 308],
  ["Stakeholder Map", 3189, 278, 170, 309],
  ["AI Copilot", 3150, 269, 155, 298],
  ["Custom Reports", 3098, 258, 162, 305],
  ["Team Spaces", 3045, 241, 148, 291],
  ["Task Automation", 2987, 235, 159, 288],
  ["Kanban Board", 2934, 228, 142, 279]
];

// ── Beta feature usage 2025 ──
var BETA_USAGE_2025 = [
  ["Feature", "Total Uses", "Total Duration (hrs)", "Error Count", "Error Rate (%)", "Usage Records"],
  ["AI Search", 492, 43, 27, 5.5, 46],
  ["Smart Alerts", 378, 37, 28, 7.4, 36],
  ["AI Copilot", 376, 32, 27, 7.2, 36],
  ["AI Agent Builder", 367, 35, 18, 4.9, 37],
  ["AI Summary", 356, 31, 16, 4.5, 35]
];

// ── Support tickets 2025 by month ──
var SUPPORT_2025 = [
  ["Month", "Low", "Medium", "High", "Urgent", "Total", "Avg CSAT", "Avg Resolution (hrs)"],
  ["Jan 2025", 21, 20, 24, 20, 85, 3.94, 36.5],
  ["Feb 2025", 20, 12, 21, 20, 73, 3.98, 33.3],
  ["Mar 2025", 28, 21, 17, 26, 92, 3.73, 35.2],
  ["Apr 2025", 14, 19, 27, 21, 81, 3.81, 33.4],
  ["May 2025", 14, 22, 24, 21, 81, 4.15, 35.2],
  ["Jun 2025", 23, 18, 18, 19, 78, 4.00, 38.4],
  ["Jul 2025", 16, 18, 16, 20, 70, 4.00, 40.8],
  ["Aug 2025", 23, 15, 23, 21, 82, 3.96, 33.8],
  ["Sep 2025", 27, 26, 20, 23, 96, 4.36, 34.3],
  ["Oct 2025", 26, 25, 21, 16, 88, 4.02, 36.2],
  ["Nov 2025", 10, 27, 20, 27, 84, 3.82, 35.9],
  ["Dec 2025", 19, 25, 26, 28, 98, 3.84, 33.8]
];

// ── Account segmentation: Industry x Tier ──
var ACCT_BY_INDUSTRY_TIER = [
  ["Industry", "Basic", "Pro", "Enterprise", "Total"],
  ["Cybersecurity", 31, 38, 31, 100],
  ["DevTools", 36, 42, 35, 113],
  ["EdTech", 28, 27, 24, 79],
  ["FinTech", 34, 41, 37, 112],
  ["HealthTech", 39, 30, 27, 96]
];

// ── Account segmentation: Country x Tier ──
var ACCT_BY_COUNTRY = [
  ["Country", "Basic", "Pro", "Enterprise", "Total"],
  ["US", 95, 110, 86, 291],
  ["UK", 23, 17, 18, 58],
  ["India", 22, 14, 13, 49],
  ["Australia", 10, 14, 8, 32],
  ["Germany", 6, 7, 12, 25],
  ["Canada", 6, 9, 8, 23],
  ["France", 6, 7, 9, 22]
];

// ── Pricing tiers ──
var PRICING = { Basic: 29, Pro: 79, Enterprise: 199 };

// ── Key personnel ──
var PEOPLE = {
  ceo: "Alex Park",
  vpProduct: "Sarah Chen",
  engLead: "Jake Morrison",
  dataLead: "Priya Patel",
  designLead: "Li Wei",
  salesLead: "David Kim",
  csLead: "Emily Rodriguez",
  marketingLead: "Jen Nakamura",
  securityLead: "Omar Hassan",
  hrLead: "Rina Gupta"
};


// ═══════════════════════════════════════════════════════════════════════════════
// NARRATIVE CONSTANTS (numbers used across docs — single source of truth)
// ═══════════════════════════════════════════════════════════════════════════════

var COMPANY_INFO = {
  name: "RavenStack",
  founded: "Q3 2023",
  productLaunch: "January 2024",
  seedFunding: 3500000,  // $3.5M
  headcountStart2025: 52,
  headcountEnd2025: 87,
  headcountTarget2026: 140,
  newHires2026: 53,
  londonOfficeOpened: "September 2025",
  londonOfficeStaff: 4,
  trialDurationDays: 14,
  annualDiscountPct: 20
};

var ORG_STRUCTURE = {
  engineering: { total: 35, corePlatform: 15, aiFeatures: 8, infrastructure: 5, other: 7 },
  support: { total: 8 },
  sales: { total: 12 },
  customerSuccess: { total: 6 },
  marketing: { total: 6 },
  design: { total: 4 },
  data: { total: 4 },
  product: { total: 3 },
  hrFinanceLegal: { total: 5 },
  executive: { total: 4 },
  other: { total: 26 }  // Marketing, Design, Data, HR, etc.
  // 35 + 8 + 12 + 6 + 26 = 87 total
};

var HIRING_2026 = {
  engineering: 20,  // AI: 5, Platform: 5, Infra: 3, Security: 2, Frontend: 3, QA: 2
  support: 7,       // Tier 1: 4, Enterprise Tier 2: 3
  sales: 8,         // AEs: 4, SDRs: 2, International: 2
  customerSuccess: 6, // Enterprise CSMs: 4, CS Ops: 2
  other: 12,        // Marketing: 4, Design: 2, Data: 3, HR/Finance/Legal: 3
  total: 53,
  incrementalPayroll: 6500000,  // $6.5M
  nonHeadcount: 700000,         // $500K localization + $200K infra
  totalInvestment: 7200000      // $7.2M
};

var COMPETITORS = {
  acmeSaaS: {
    founded: 2020,
    hq: "Austin, TX",
    funding: { seriesC: 50000000, total: 82000000 },
    employees: 200,
    customers: 2000,
    estimatedARR: 40000000,
    estimatedAnnualChurn: 0.08,
    estimatedNPS: "40-50",
    pricing: { basic: 49, pro: 149, enterprise: 279 },
    certifications: ["SOC 2 Type II", "HIPAA", "ISO 27001"],
    nativeIntegrations: 12,
    mobileApp: { iosStars: 4.7, androidStars: 4.5, downloads: 50000 },
    competitiveDeals: { total: 45, won: 28, lost: 17, winRate: 0.62 }
  },
  nimbusApp: {
    fundingSeriesA: 15000000,
    fundingLead: "a16z",
    estimatedARR: 12000000,
    pricing: { singleTier: 99 },
    features: 15,
    customers: 400
  }
};

var RETENTION_METRICS = {
  totalUpgrades2025: 529,
  totalDowngrades2025: 218,
  upgradeDowngradeRatio: 2.4,
  basicToProPctOfUpgrades: 0.60,
  basicToProRetentionRate: 0.95,
  uniqueChurnedAccounts: 110,
  accountChurnRate: 0.22,
  estimatedNRR: "115-125%",
  churnLostRevenueAnnualized: "1500000-2000000"
};

var TRIAL_DATA = {
  totalTrials: 97,
  converted: 97,
  conversionRate: 1.0,
  durationDays: 14,
  postTrialBasicPct: 0.40,
  postTrialProPct: 0.35,
  postTrialEnterprisePct: 0.25,
  byIndustry: [
    ["FinTech", 22], ["DevTools", 21], ["Cybersecurity", 19],
    ["HealthTech", 18], ["EdTech", 17]
  ]
};

var RESEARCH_FINDINGS = {
  onboarding: {
    interviews: 12, surveyResponses: 200,
    avgTimeToValue: 45,  // minutes
    timeByRole: { engManagers: 30, productManagers: 45, directors: 60 },
    featureDiscoveryFirstMonth: "8-10",
    surveyDifficultSetup: 0.62,
    surveyFewerFeatures: 0.78,
    surveyNoAIAwareness: 0.45,
    surveyWantGuidedOnboarding: 0.88,
    onboardingNPS: 22,
    competitorTimeToValue: 15  // AcmeSaaS, minutes
  },
  powerUsers: {
    interviews: 8, durationMin: "60-75",
    qualifyingAccounts: 45, pctOfTotal: 0.09,
    avgFeaturesUsed: 23,
    avgTeamMembersReferred: 4.2
  },
  enterpriseBuyers: {
    interviews: 15
  },
  churnCorrelations: {
    fifteenPlusFeatures: "3x lower churn",
    threeUrgentTickets: "4x churn probability"
  }
};

var SUPPORT_EXTENDED = {
  totalEscalationsAllTime: 95,
  escalationRate: 0.0475,  // 95 / ~2000 all-time tickets
  teamSize: 8,
  avgNotificationsPerDayEnterprise: 47,
  notificationCTR: 0.12
};

var SMART_ALERTS_LAUNCH = {
  uniqueAccountsTried: 35,
  pctEnterpriseTried: 0.23,
  errorBreakdown: { falsePositives: 0.40, wrongChannel: 0.30, timing: 0.20, content: 0.10 },
  targets: { volumeReduction: 0.60, ctrTarget: 0.40 },
  copilotStagingErrorRate: 0.058  // improved from 7.2% to 5.8%
};

var BETA_GA_TIMELINE = {
  aiSearch: { gaReady: "Yes", targetGA: "Jan 2026", blocker: "None — documentation in progress" },
  aiSummary: { gaReady: "Nearly", targetGA: "Feb 2026", blocker: "Minor UX improvements" },
  aiAgentBuilder: { gaReady: "Nearly", targetGA: "Mar 2026", blocker: "Enterprise-only initially" },
  aiCopilot: { gaReady: "No", targetGA: "Q2 2026", blocker: "Error rate too high, UX issues" },
  smartAlerts: { gaReady: "No", targetGA: "Q2 2026", blocker: "Error rate too high, false positive rate" }
};

var PRODUCT_DETAILS = {
  featuresByTier: { basic: 25, pro: 35, enterprise: 40 },
  technologyPartners: 8,
  soc2Target: "Q2 2026"
};

var MARKETING_Q4 = {
  spend: 450000,
  priorQuarterSpend: 320000,
  leads: 1850,
  mqls: 620,
  cpl: 243  // 450K / 1850
};

var EMPLOYEE_SATISFACTION = {
  overallScore: 4.1  // out of 5
};

var PARTNER_PROGRAM = {
  activePartners: 55
};

var SECURITY_COMPLIANCE = {
  controlGaps: 18,
  gapsClosed: 12,
  soc2Target: "Q2 2026"
};

var FINANCIAL_PROJECTIONS = {
  arrRunRate: 27281124,  // Dec MRR x 12
  churnReductionTarget: 3000000,  // $3M ARR
  enterpriseGrowthTarget: 0.50,
  internationalNewARR: 2000000,
  avgEnterpriseDealMRR: 15000,  // new deals in Q4
  newEnterpriseDealsQ4: 12
};


// ═══════════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

function getOrCreateFolder() {
  var folders = DriveApp.getFoldersByName(FOLDER_NAME);
  if (folders.hasNext()) return folders.next();
  return DriveApp.createFolder(FOLDER_NAME);
}

function moveToFolder(file, folder) {
  var fileObj = DriveApp.getFileById(file.getId());
  fileObj.moveTo(folder);
}

function createDocInFolder(title, bodyText, folder) {
  var doc = DocumentApp.create(title);
  var body = doc.getBody();
  body.clear();

  var lines = bodyText.split("\n");
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i];
    if (line.startsWith("# ")) {
      var p = body.appendParagraph(line.substring(2));
      p.setHeading(DocumentApp.ParagraphHeading.HEADING1);
    } else if (line.startsWith("## ")) {
      var p = body.appendParagraph(line.substring(3));
      p.setHeading(DocumentApp.ParagraphHeading.HEADING2);
    } else if (line.startsWith("### ")) {
      var p = body.appendParagraph(line.substring(4));
      p.setHeading(DocumentApp.ParagraphHeading.HEADING3);
    } else if (line.startsWith("#### ")) {
      var p = body.appendParagraph(line.substring(5));
      p.setHeading(DocumentApp.ParagraphHeading.HEADING4);
    } else if (line.startsWith("- ")) {
      var p = body.appendListItem(line.substring(2));
      p.setGlyphType(DocumentApp.GlyphType.BULLET);
    } else if (line.startsWith("  - ")) {
      var p = body.appendListItem(line.substring(4));
      p.setGlyphType(DocumentApp.GlyphType.HOLLOW_BULLET);
      p.setNestingLevel(1);
    } else {
      body.appendParagraph(line);
    }
  }

  doc.saveAndClose();
  moveToFolder(doc, folder);
  var wordCount = bodyText.split(/\s+/).length;
  Logger.log("Created Doc: " + title + " (" + wordCount + " words)");
  return doc;
}

function createSheetInFolder(title, sheetsData, folder) {
  var ss = SpreadsheetApp.create(title);
  var totalDataPoints = 0;
  for (var i = 0; i < sheetsData.length; i++) {
    var sheet;
    if (i === 0) {
      sheet = ss.getActiveSheet();
      sheet.setName(sheetsData[i].name);
    } else {
      sheet = ss.insertSheet(sheetsData[i].name);
    }
    var data = sheetsData[i].data;
    if (data.length > 0 && data[0].length > 0) {
      sheet.getRange(1, 1, data.length, data[0].length).setValues(data);
      sheet.getRange(1, 1, 1, data[0].length).setFontWeight("bold");
      totalDataPoints += data.length * data[0].length;
    }
  }
  var allSheets = ss.getSheets();
  for (var j = 0; j < allSheets.length; j++) {
    var found = false;
    for (var k = 0; k < sheetsData.length; k++) {
      if (sheetsData[k].name === allSheets[j].getName()) { found = true; break; }
    }
    if (!found && allSheets.length > 1) {
      try { ss.deleteSheet(allSheets[j]); } catch(e) {}
    }
  }
  moveToFolder(ss, folder);
  Logger.log("Created Sheet: " + title + " (" + totalDataPoints + " data points)");
  return ss;
}

function createSlidesInFolder(title, slidesContent, folder) {
  var pres = SlidesApp.create(title);
  var defaultSlides = pres.getSlides();
  var totalWords = 0;

  for (var i = 0; i < slidesContent.length; i++) {
    var slide = pres.appendSlide(SlidesApp.PredefinedLayout.TITLE_AND_BODY);
    var shapes = slide.getShapes();
    if (shapes.length >= 1) {
      shapes[0].getText().setText(slidesContent[i].title);
    }
    if (shapes.length >= 2 && slidesContent[i].bullets) {
      var bulletText = slidesContent[i].bullets.join("\n");
      shapes[1].getText().setText(bulletText);
      totalWords += bulletText.split(/\s+/).length;
    }
    totalWords += slidesContent[i].title.split(/\s+/).length;
  }
  if (defaultSlides.length > 0) {
    defaultSlides[0].remove();
  }
  pres.saveAndClose();
  moveToFolder(pres, folder);
  Logger.log("Created Slides: " + title + " (" + totalWords + " words, " + slidesContent.length + " slides)");
  return pres;
}


// ═══════════════════════════════════════════════════════════════════════════════
// CLEANUP
// ═══════════════════════════════════════════════════════════════════════════════

function cleanupFolder() {
  var folders = DriveApp.getFoldersByName(FOLDER_NAME);
  if (!folders.hasNext()) {
    Logger.log("No folder found named: " + FOLDER_NAME);
    return;
  }
  var folder = folders.next();
  var files = folder.getFiles();
  var count = 0;
  while (files.hasNext()) {
    var file = files.next();
    Logger.log("Deleting: " + file.getName());
    file.setTrashed(true);
    count++;
  }
  Logger.log("Deleted " + count + " files from " + FOLDER_NAME);
  folder.setTrashed(true);
  Logger.log("Folder trashed. Run a batch function to recreate it.");
}


// ═══════════════════════════════════════════════════════════════════════════════
// BATCH ORCHESTRATORS
// ═══════════════════════════════════════════════════════════════════════════════

function runBatch1() {
  var folder = getOrCreateFolder();
  Logger.log("=== BATCH 1: Docs 1-5 (Roadmaps, Competitors, First Sync) ===");
  createBatch1Docs(folder);
  Logger.log("=== BATCH 1 COMPLETE ===");
  Logger.log("Folder: https://drive.google.com/drive/folders/" + folder.getId());
}

function runBatch2() {
  var folder = getOrCreateFolder();
  Logger.log("=== BATCH 2: Docs 6-10 (Syncs, MRR Sheets, Churn Sheet) ===");
  createBatch2Docs(folder);
  Logger.log("=== BATCH 2 COMPLETE ===");
  Logger.log("Folder: https://drive.google.com/drive/folders/" + folder.getId());
}

function runBatch3() {
  var folder = getOrCreateFolder();
  Logger.log("=== BATCH 3: Docs 11-18 (Feature, Support, Account, Trial Sheets) ===");
  createBatch3Docs(folder);
  Logger.log("=== BATCH 3 COMPLETE ===");
  Logger.log("Folder: https://drive.google.com/drive/folders/" + folder.getId());
}

function runBatch4() {
  var folder = getOrCreateFolder();
  Logger.log("=== BATCH 4: Docs 19-25 (UX Research, API, PRD, Checklist, Board Deck) ===");
  createBatch4Docs(folder);
  Logger.log("=== BATCH 4 COMPLETE ===");
  Logger.log("Folder: https://drive.google.com/drive/folders/" + folder.getId());
}

function runBatch5() {
  var folder = getOrCreateFolder();
  Logger.log("=== BATCH 5: Docs 26-35 (QBR Deck, Analysis Docs, Adjacent Docs) ===");
  createBatch5Docs(folder);
  Logger.log("=== BATCH 5 COMPLETE ===");
  Logger.log("Folder: https://drive.google.com/drive/folders/" + folder.getId());
}

function runBatch6() {
  var folder = getOrCreateFolder();
  Logger.log("=== BATCH 6: Docs 36-50 (Adjacent + Irrelevant) ===");
  createBatch6Docs(folder);
  Logger.log("=== BATCH 6 COMPLETE ===");
  Logger.log("Folder: https://drive.google.com/drive/folders/" + folder.getId());
}
