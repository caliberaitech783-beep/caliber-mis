// Employee Master fields that the ERP owns. The ERP sync writes only these; Employee Master edits leave them as ERP sent them.
// Employee Master field <- ERP column (CMPL.EMPLOYEE, see server/services/erp-employee-sync.mjs).
export const ERP_EMPLOYEE_COLUMNS={
 tno:'TNO',employeeCode:'EMPLOYEECODE',caliberId:'EMPLOYEEID',name:'EMPLOYEENAME',employeeShortName:'EMPLOYEESHORTNAME',fatherName:'FATHERNAME',spouseName:'HUSBANDNAME',
 gender:'GENDER',maritalStatus:'MARITALSTATUS',bloodGroup:'BLOODGROUP',dateOfBirth:'DATEOFBIRTH',dateOfAppointment:'DATEOFAPPOINTMENT',dateOfJoining:'DATEOFJOINING',
 departmentCode:'DEPARTMENTCODE',departmentName:'DEPARTMENTNAME',designationCode:'DESIGNATIONCODE',designationName:'DESIGNATIONNAME',
 currentDepartmentName:'CURRENTDEPARTMENTNAME',currentDesignationName:'CURRENTDESIGNATIONNAME',
 locationCode:'LOCATIONCODE',locationName:'LOCATIONNAME',shiftCode:'SHIFTCODE',shiftName:'SHIFTNAME',staffTypeCode:'STAFFTYPECODE',staffType:'STAFFTYPENAME',
 employeeTypeCode:'EMPLOYEETYPECODE',employeeType:'EMPLOYEETYPENAME',companyCode:'COMPANYCODE',companyName:'COMPANYNAME',
 leaveSchemeCode:'LEAVESCHEMECODE',leaveSchemeName:'LEAVESCHEMENAME',salarySchemeCode:'SALARYSCHEMECODE',salarySchemeName:'SALARYSCHEMENAME',
 skillsCode:'SKILLSCODE',skills:'SKILLSNAME',workCentre:'WORKCENTRENAME',paymentMode:'PAYMENTMODENAME',bankCode:'BANKCODE',bankName:'BANKNAME',ifscCode:'IFSCCODE',bankAccountNo:'BANKACCOUNTNO',
 presentAddress:'PRESENTADDRESS',presentCity:'PRESENTCITY',presentState:'PRESENTSTATE',presentPhoneNo:'PRESENTPHONENO',
 permanentAddress:'PERMANENTADDRESS',permanentCity:'PERMANENTCITY',permanentState:'PERMANENTSTATE',
 officeMobileNo:'OFFICEMOBILENO',officeEmailId:'OFFICEEMAILID',personalMobileNo:'PERSONALMOBILENO',personalEmailId:'PERSONALEMAILID',monthlyCtc:'MONTHLYCTC',
 pfDeduction:'PFDEDUCTIONON',isEsicApplicable:'ISESICAPPLICABLE',offday:'OFFDAY',ishod:'ISHOD',canAllowVisitor:'CANALLOWVISITOR',isSignatory:'ISSIGNATORY',isGroupSignatory:'ISGROUPSIGNATORY',
 coffAllowed:'COFFALLOWED',isSinglePunchAllowed:'ISSINGLEPUNCHALLOWED',
 adharNo:'ADHARNO',pfAccountNo:'PFACCOUNTNO',esicAccountNo:'ESICACCOUNTNO',esicEstablishmentCodeNo:'ESICESTABLISHMENTCODENO',panNo:'PANNO',uan:'UAN',
 drivingLicenseNo:'DRIVINGLICENSENO',drivingLicenseExpiryDate:'DRIVINGLICENSEEXPIRYDATE'
};
// Salary Account is not taken from the ERP: SALARYACCOUNTCODE is a ledger code (two values), not the employee's account.
export const ERP_EMPLOYEE_FIELDS=Object.keys(ERP_EMPLOYEE_COLUMNS);
export const isErpEmployee=record=>Boolean(record?.erpSyncedAt)&&record?.erpMissing!==true;
