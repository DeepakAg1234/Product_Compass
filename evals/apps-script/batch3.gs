/**
 * Batch 3: Docs 11-18 (All Sheets — kept at original size)
 * 11. Churn Analysis Q1-Q2 2025 (Sheet)
 * 12. Feature Adoption Report (Full Year 2025) (Sheet)
 * 13. Feature Adoption: Beta Features Deep Dive (Sheet)
 * 14. Support Ticket Analytics (2025) (Sheet)
 * 15. Support Ticket Analytics (H1 vs H2 Comparison) (Sheet)
 * 16. Account Segmentation Summary (Sheet)
 * 17. Enterprise Account Deep Dive (Sheet)
 * 18. Trial-to-Paid Conversion Analysis (Sheet)
 */

function createBatch3Docs(folder) {

  // ── Sheet 11: Churn Analysis Q1-Q2 2025 ──
  var churnQ1Q2 = CHURN_DATA.filter(function(row, i) {
    return i === 0 || (typeof row[0] === "string" && (row[0].indexOf("2025-Q1") >= 0 || row[0].indexOf("2025-Q2") >= 0));
  });
  createSheetInFolder("Churn Analysis Q1-Q2 2025", [
    { name: "By Reason", data: churnQ1Q2 },
    { name: "Key Findings", data: [
      ["Finding", "Detail"],
      ["Total Q1-Q2 Churn Events", 144],
      ["Q1 Events", 52],
      ["Q2 Events", 92],
      ["Q1 Top Reason", "Features (13 events)"],
      ["Q2 Top Reason", "Competitor (20 events)"],
      ["Q1-Q2 Total Refunds", "$1,593.57"],
      ["QoQ Increase", "77% (Q1→Q2)"]
    ]}
  ], folder);


  // ── Sheet 12: Feature Adoption Report (Full Year 2025) ──
  createSheetInFolder("Feature Adoption Report (Full Year 2025)", [
    { name: "All Features", data: [FEATURE_USAGE_2025[0]].concat(FEATURE_USAGE_ALL) },
    { name: "Summary", data: [
      ["Metric", "Value"],
      ["Total Features Tracked", 40],
      ["Most Used Feature", "Inbox Zero (3,606 uses)"],
      ["2nd Most Used", "Notification Center (3,463 uses)"],
      ["3rd Most Used", "Integrations Hub (3,457 uses)"],
      ["Highest Error Count", "Video Conferencing (205 errors)"],
      ["Total Usage Records (2025)", "~10,600"],
      ["Beta Features in Market", 5],
      ["Top Beta Feature", "AI Search (492 uses)"]
    ]}
  ], folder);


  // ── Sheet 13: Feature Adoption: Beta Features Deep Dive ──
  createSheetInFolder("Feature Adoption: Beta Features Deep Dive", [
    { name: "Beta Usage", data: BETA_USAGE_2025 },
    { name: "GA Readiness", data: [
      ["Feature", "Error Rate (%)", "Usage Volume", "GA Ready?", "Target GA Date", "Blocker"],
      ["AI Search", 5.5, 492, "Yes", "Jan 2026", "None — documentation in progress"],
      ["AI Summary", 4.5, 356, "Nearly", "Feb 2026", "Minor UX improvements needed"],
      ["AI Agent Builder", 4.9, 367, "Nearly", "Mar 2026", "Enterprise-only initially"],
      ["AI Copilot", 7.2, 376, "No", "Q2 2026", "Error rate too high, UX issues"],
      ["Smart Alerts", 7.4, 378, "No", "Q2 2026", "Error rate too high, false positive rate"]
    ]}
  ], folder);


  // ── Sheet 14: Support Ticket Analytics (2025) ──
  createSheetInFolder("Support Ticket Analytics (2025)", [
    { name: "Monthly Breakdown", data: SUPPORT_2025 },
    { name: "Summary", data: [
      ["Metric", "Value"],
      ["Total Tickets (2025)", 1008],
      ["Average Monthly Tickets", 84],
      ["Peak Month", "December (98 tickets)"],
      ["Lowest Month", "July (70 tickets)"],
      ["Average CSAT", 3.97],
      ["Best CSAT Month", "September (4.36)"],
      ["Worst CSAT Month", "March (3.73)"],
      ["Average Resolution Time", "35.6 hours"],
      ["Fastest Resolution", "February (33.3 hrs)"],
      ["Slowest Resolution", "July (40.8 hrs)"],
      ["Total Escalations (all time)", 95],
      ["Escalation Rate", "4.75%"]
    ]}
  ], folder);


  // ── Sheet 15: Support Ticket Analytics (H1 vs H2 Comparison) ──
  createSheetInFolder("Support Ticket Analytics (H1 vs H2 Comparison)", [
    { name: "Comparison", data: [
      ["Metric", "H1 2025 (Jan-Jun)", "H2 2025 (Jul-Dec)", "Change"],
      ["Total Tickets", 490, 518, "+5.7%"],
      ["Avg Monthly Tickets", 81.7, 86.3, "+5.7%"],
      ["Urgent Tickets", 127, 135, "+6.3%"],
      ["High Tickets", 131, 126, "-3.8%"],
      ["Avg CSAT", 3.94, 4.00, "+0.06"],
      ["Avg Resolution (hrs)", 35.3, 35.8, "+0.5"],
      ["Peak Month", "March (92)", "December (98)", ""],
      ["Lowest Month", "February (73)", "July (70)", ""]
    ]},
    { name: "H1 Detail", data: SUPPORT_2025.filter(function(r,i) { return i === 0 || i <= 6; }) },
    { name: "H2 Detail", data: [SUPPORT_2025[0]].concat(SUPPORT_2025.slice(7)) }
  ], folder);


  // ── Sheet 16: Account Segmentation Summary ──
  createSheetInFolder("Account Segmentation Summary", [
    { name: "By Industry", data: ACCT_BY_INDUSTRY_TIER },
    { name: "By Country", data: ACCT_BY_COUNTRY },
    { name: "Summary", data: [
      ["Metric", "Value"],
      ["Total Accounts", 500],
      ["Basic Accounts", 168],
      ["Pro Accounts", 178],
      ["Enterprise Accounts", 154],
      ["Trial Accounts", 97],
      ["Churned Accounts", 110],
      ["Churn Rate (account-level)", "22%"],
      ["Top Industry", "DevTools (113)"],
      ["Top Country", "US (291)"],
      ["Top Referral Source", "Organic, Ads, Partner, Event, Other"],
      ["Avg Seats per Account", "~30-54 avg (range: 5-150+)"]
    ]}
  ], folder);


  // ── Sheet 17: Enterprise Account Deep Dive ──
  createSheetInFolder("Enterprise Account Deep Dive", [
    { name: "By Industry", data: [
      ["Industry", "Enterprise Accounts", "% of Total Enterprise"],
      ["FinTech", 37, "24.0%"],
      ["DevTools", 35, "22.7%"],
      ["Cybersecurity", 31, "20.1%"],
      ["HealthTech", 27, "17.5%"],
      ["EdTech", 24, "15.6%"]
    ]},
    { name: "By Country", data: [
      ["Country", "Enterprise Accounts", "% of Total Enterprise"],
      ["US", 86, "55.8%"],
      ["UK", 18, "11.7%"],
      ["India", 13, "8.4%"],
      ["Germany", 12, "7.8%"],
      ["France", 9, "5.8%"],
      ["Canada", 8, "5.2%"],
      ["Australia", 8, "5.2%"]
    ]},
    { name: "Key Metrics", data: [
      ["Metric", "Value"],
      ["Total Enterprise Accounts", 154],
      ["Enterprise MRR (Dec 2025)", "$1,652,695"],
      ["Enterprise % of Total MRR", "72.7%"],
      ["Avg Enterprise MRR per Account", "$10,732"],
      ["Enterprise Upgrades", "~200 (estimated from 529 total)"],
      ["Enterprise Downgrades", "~80 (estimated from 218 total)"],
      ["Top Enterprise Vertical", "FinTech (37 accounts)"],
      ["Fastest Growing Enterprise Vertical", "DevTools (+35 accounts in 2024-2025)"]
    ]}
  ], folder);


  // ── Sheet 18: Trial-to-Paid Conversion Analysis ──
  createSheetInFolder("Trial-to-Paid Conversion Analysis", [
    { name: "Conversion Summary", data: [
      ["Metric", "Value"],
      ["Total Trial Accounts", 97],
      ["Converted to Paid", 97],
      ["Conversion Rate", "100%"],
      ["Avg Trial Duration", "14 days (standard)"],
      ["Most Common Post-Trial Plan", "Basic (estimated ~40%)"],
      ["Second Most Common", "Pro (estimated ~35%)"],
      ["Enterprise Conversions", "Estimated ~25%"]
    ]},
    { name: "Trial by Industry", data: [
      ["Industry", "Trial Accounts", "Converted", "Rate"],
      ["FinTech", 22, 22, "100%"],
      ["DevTools", 21, 21, "100%"],
      ["Cybersecurity", 19, 19, "100%"],
      ["HealthTech", 18, 18, "100%"],
      ["EdTech", 17, 17, "100%"]
    ]},
    { name: "Notes", data: [
      ["Note"],
      ["100% conversion rate is unusually high and may indicate:"],
      ["1. Strong product-market fit in our target verticals"],
      ["2. Self-selection bias — only serious buyers start trials"],
      ["3. Effective onboarding (though user research suggests room for improvement)"],
      ["4. Possible measurement gap — abandoned trials may not be tracked"],
      ["Recommendation: audit trial tracking to ensure we capture abandoned trials"]
    ]}
  ], folder);
}
