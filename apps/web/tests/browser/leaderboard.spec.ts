import {test,expect} from '@playwright/test';
import {emptyView,type LeaderboardView} from '../../lib/arkiv/model';
const player='0x0000000000000000000000000000000000000011';
function season(id='1'):LeaderboardView {return {...emptyView(),status:'live',season:{id,startBlock:'100',endBlock:'160'},block:'159',remainingSeconds:1,updatedAt:Date.now(),rows:[{player,points:100,wins:1,spins:1}],players:1,message:''};}
test('iPad and phone share pushed standings; countdown cannot invent a season reset',async({page,context,request})=>{
  await request.post('/fixture/season',{data:season()});
  const phone=await context.newPage();await phone.setViewportSize({width:390,height:844});
  const requests:string[]=[];page.on('request',req=>{if(req.url().includes('/api/leaderboard'))requests.push(req.url());});
  await page.goto('/');await phone.goto('/phone-fixture');
  await page.getByRole('button',{name:'Season leaderboard',exact:true}).click();
  await expect(page.locator('#leaderboard-rows')).toContainText('100');
  await expect(phone.getByRole('region',{name:'Season leaderboard'})).toContainText('100');
  await expect(page.locator('#leaderboard-countdown')).toHaveText('Waiting for season change');
  await expect(page.locator('#leaderboard-title')).toHaveText('Season 1');
  await expect(page.locator('#leaderboard-rows')).toContainText('100');
  await request.post('/fixture/season',{data:{...season(),status:'unavailable',message:'Reconnecting. Standings may be out of date.'}});
  await expect(page.locator('#leaderboard-countdown')).toHaveText('Waiting for connection');
  await expect(phone.getByRole('region',{name:'Season leaderboard'})).toContainText('Waiting for connection');
  await request.post('/fixture/season',{data:{...season('2'),remainingSeconds:120,rows:[],players:0}});
  await expect(page.locator('#leaderboard-title')).toHaveText('Season 2');
  await expect(page.locator('#leaderboard-rows tr')).toHaveCount(0);
  await expect(phone.getByRole('region',{name:'Season leaderboard'})).toContainText('No spins in this season yet.');
  expect(requests).toEqual(['http://localhost:3101/api/leaderboard/stream']);
  await page.screenshot({path:'artifacts/arkiv-season-ipad.png'});
  await phone.getByRole('region',{name:'Season leaderboard'}).screenshot({path:'artifacts/arkiv-season-phone.png'});
  await page.locator('#leaderboard-close').click();await expect(page.locator('#leaderboard-dialog')).toBeHidden();
  await phone.close();await request.post('/fixture/season',{data:emptyView()});
});
