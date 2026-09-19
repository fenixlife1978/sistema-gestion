const {cookieOptions}=require('../../lib/auth');
module.exports=async function handler(req,res){
  res.setHeader('Cache-Control','no-store');
  if(req.method!=='POST') return res.status(405).json({error:'Method not allowed'});
  res.setHeader('Set-Cookie','erp_session=; '+cookieOptions(0));
  return res.status(200).json({ok:true});
};
