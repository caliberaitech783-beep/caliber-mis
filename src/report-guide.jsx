import React from 'react';
import './report-guide.css';
import {reportGuide} from './report-guide-list.mjs';

// The operating manual of the open report tab, to download in English or Hindi.
export default function ReportGuide({id}){
 const guide=reportGuide(id);
 if(!guide)return null;
 // A div, not an aside: the app styles every bare <aside> as the fixed side menu, which would lay this bar over the report.
 return <div className="report-guide" role="complementary" aria-label="Operating manual for this report">
  <strong>Operating manual</strong><span>How to use this report, step by step.</span>
  <a href={guide.en} download>Download in English</a>
  <a href={guide.hi} download lang="hi">हिंदी में डाउनलोड करें</a>
 </div>;
}
