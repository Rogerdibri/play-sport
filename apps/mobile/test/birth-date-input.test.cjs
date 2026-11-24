const assert=require('node:assert/strict'),{test}=require('node:test'),React=require('react');
const {renderToStaticMarkup}=require('react-dom/server');
const nativePath=require.resolve('react-native');
let inputs=[];
const element=tag=>({children,accessibilityRole})=>React.createElement(tag,{role:accessibilityRole},children);
const TextInput=React.forwardRef((props,_ref)=>{inputs.push(props);return React.createElement('input',{'aria-label':props.accessibilityLabel,defaultValue:props.value});});
require.cache[nativePath]={id:nativePath,filename:nativePath,loaded:true,exports:{
  Text:element('span'),View:element('div'),TextInput,StyleSheet:{create:value=>value}
}};
const BirthDateInput=require('../birth-date-input').default;
function setup(t){
  let value='',focused=-1,index=0;
  t.mock.method(React,'useRef',()=>{const current=index++%3;return{current:{focus(){focused=current;}}};});
  const render=(next=value,editable=true)=>{
    value=next;inputs=[];
    return renderToStaticMarkup(React.createElement(BirthDateInput,{label:'Nacimiento de prueba',value,editable,onChange(next){value=next;}}));
  };
  return{render,input:(index,text)=>inputs[index].onChangeText(text),inputs:()=>inputs,value:()=>value,focused:()=>focused};
}
test('native birth entry advances day then month and keeps ISO storage ordering',t=>{
  const e=setup(t);e.render();e.input(0,'1');assert.equal(e.focused(),-1);
  e.render();e.input(0,'12');assert.equal(e.focused(),1);
  e.render();e.input(1,'03');assert.equal(e.focused(),2);
  e.render();e.input(2,'1990');assert.equal(e.value(),'1990-03-12');assert.equal(e.focused(),2);
});
test('native invalid segments remain editable without auto-advance and invalid dates are explicit',t=>{
  const e=setup(t);e.render();e.input(0,'32');assert.equal(e.focused(),-1);assert.match(e.render(),/role="alert"/);
  e.render('1990--12');e.input(1,'13');assert.equal(e.focused(),-1);assert.match(e.render(),/un mes entre 01 y 12/);
  assert.match(e.render('1990-02-31'),/fecha real/);assert.doesNotMatch(e.render('2000-02-29'),/role="alert"/);
});
test('native unambiguous single digits complete automatically with a leading zero',t=>{
  const e=setup(t);e.render();e.input(0,'5');assert.equal(e.value(),'--05');assert.equal(e.focused(),1);
  e.render();e.input(1,'3');assert.equal(e.value(),'-03-05');assert.equal(e.focused(),2);
});
test('native restoration, single-digit completion and backwards correction preserve all date parts',t=>{
  const e=setup(t);e.render('2015-03-20');assert.deepEqual(e.inputs().map(input=>input.value),['20','03','2015']);
  e.render('1990-03-7');e.inputs()[0].onEndEditing({nativeEvent:{text:'7'}});assert.equal(e.value(),'1990-03-07');
  e.render('1990--07');e.inputs()[1].onKeyPress({nativeEvent:{key:'Backspace'}});assert.equal(e.focused(),0);
});
test('native segments use a numeric keyboard, select existing text and respect disabled editing',t=>{
  const e=setup(t);e.render('',false);
  assert.ok(e.inputs().every(input=>input.keyboardType==='number-pad'&&input.selectTextOnFocus&&input.editable===false));
  assert.deepEqual(e.inputs().map(input=>input.accessibilityLabel),['Nacimiento de prueba: día','Nacimiento de prueba: mes','Nacimiento de prueba: año']);
});
