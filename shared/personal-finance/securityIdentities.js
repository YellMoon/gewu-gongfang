'use strict';
// Issuer disclosures identify subscription codes separately from listed codes.
// Limit each reference to its issuance window; preserve the statement's code.
const ISSUES=Object.freeze([
 {subscriptionCode:'730930',securityCode:'600930',securityName:'\u534e\u7535\u65b0\u80fd',from:'2025-07-07',through:'2025-08-31',source:'https://paper.cnstock.com/html/2025-07/04/content_2089309.htm'},
 {subscriptionCode:'754019',securityCode:'113708',securityName:'\u66d926\u8f6c\u503a',from:'2026-07-15',through:'2026-08-31',source:'https://static.cninfo.com.cn/finalpage/2026-07-13/1225420515.PDF'}
]);
function brokerageSecurityIdentity(b,date){
 const match=ISSUES.find(i=>i.subscriptionCode===b.securityCode&&date>=i.from&&date<=i.through&&['allocation','allocation_payment','allocation_confirmation'].includes(b.activity));
 return match?{code:match.securityCode,name:match.securityName,subscriptionCode:match.subscriptionCode,source:match.source}:{code:b.securityCode,name:b.securityName};
}
module.exports={brokerageSecurityIdentity};
