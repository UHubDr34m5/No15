import {test} from 'node:test';
import assert from 'node:assert/strict';
import {teacherEmail,FirebaseBackend} from '../backend.js';
test('共通IDを正規化し、メールや不正文字を拒否する',()=>{
  assert.equal(teacherEmail(' Teacher_1 '),'teacher_1@teacher.no15.invalid');
  for(const id of ['', 'ab','教員','a@b.com','../teacher','a b','-abc','a'.repeat(33)])assert.throws(()=>teacherEmail(id));
});
function backend(allowed=true){
  const b=new FirebaseBackend(()=>{}),calls=[];
  b.init=async()=>{};b.db={};b.auth={currentUser:null};
  b.sdk={ref:(_,path)=>path,get:async path=>{calls.push(path);return {val:()=>allowed};},
    signInWithEmailAndPassword:async(auth,email,password)=>{calls.push([email,password]);auth.currentUser={uid:'host',providerData:[{providerId:'password'}]};},
    signOut:async auth=>{auth.currentUser=null;calls.push('signOut');}};
  return {b,calls};
}
test('共通IDで認証したあと、UIDの教員登録を確認する',async()=>{
  const {b,calls}=backend();await b.signTeacher('Teacher','test-only-password');
  assert.deepEqual(calls,[['teacher@teacher.no15.invalid','test-only-password'],'teachers/host']);
  await b.signTeacher();assert.equal(calls.length,3);
});
test('未登録・匿名・Google認証では教員ログインできない',async()=>{
  const {b}=backend(false);await assert.rejects(b.signTeacher('teacher','test-only-password'),/利用許可/);assert.equal(b.auth.currentUser,null);
  for(const providerId of ['anonymous','google.com']){b.auth.currentUser={uid:'other',providerData:[{providerId}]};await assert.rejects(b.signTeacher(),/教員ID/);}
});
test('誤ったパスワードでは教員情報にアクセスしない',async()=>{
  const {b,calls}=backend();b.sdk.signInWithEmailAndPassword=async()=>{throw Object.assign(Error('invalid'),{code:'auth/invalid-credential'});};
  await assert.rejects(b.signTeacher('teacher','wrong'),{code:'auth/invalid-credential'});assert.deepEqual(calls,[]);
});
