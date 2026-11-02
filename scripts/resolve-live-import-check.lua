-- Actual broadcast recording verification. No markers are created by this script.
local manager=resolve:GetProjectManager()
local project=manager:GetCurrentProject()
assert(project:GetName()=="StreamDirector Checkpoint 2 Markers","Open the isolated StreamDirector Checkpoint 2 Markers project")
local name="SD Actual Broadcast Final 30 NDF"
local footage="/Users/adnan/Developer/Hack/Projects/StreamDirectorAI /output/checkpoint-3/actual-obs-recording.mov"
local expected={
{frame=6273,name="Streamer marked this moment",note="manual: Confirmed manual event [twitch:238520082:316456451563:1]"},
{frame=10247,name="Streamer marked this moment",note="manual: Confirmed manual event [twitch:238520082:316456451563:2]"},
{frame=16423,name="Streamer marked this moment",note="manual: Confirmed manual event [twitch:238520082:316456451563:3]"}
}
local timeline=nil
for i=1,project:GetTimelineCount() do
 local candidate=project:GetTimelineByIndex(i)
 if candidate:GetName()==name then timeline=candidate end
end
if sd_action=='prepare' then
 if not timeline then timeline=assert(project:GetMediaPool():CreateEmptyTimeline(name)) end
 local clips=timeline:GetItemListInTrack('video',1)
 if not clips or #clips==0 then
  assert(timeline:SetSettings({useCustomSettings='1'}))
  assert(timeline:SetSettings({timelineFrameRate='30'}))
  assert(timeline:SetStartTimecode('01:00:00:00'))
  local media=project:GetMediaPool():ImportMedia({footage})
  assert(media and media[1],'Actual recording import failed')
  assert(project:SetCurrentTimeline(timeline))
  assert(project:GetMediaPool():AppendToTimeline({{mediaPoolItem=media[1]}}))
 end
 print('PREPARED '..name..' | fps='..timeline:GetSetting('timelineFrameRate')..' | start='..timeline:GetStartTimecode()..' | clips='..#timeline:GetItemListInTrack('video',1))
 print('Use Media Pool timeline item > Timelines > Import > Timeline Markers from EDL: actual-broadcast-30-one-hour.edl')
elseif sd_action=='verify' then
 assert(timeline,'Prepare timeline first')
 local markers=timeline:GetMarkers()
 local count=0;for _ in pairs(markers)do count=count+1 end
 local clips=timeline:GetItemListInTrack('video',1)
 local actualFootage=clips and clips[1] and clips[1]:GetMediaPoolItem():GetClipProperty('File Path') or ''
 local pass=count==3 and tonumber(timeline:GetSetting('timelineFrameRate'))==30 and timeline:GetStartTimecode()=='01:00:00:00' and actualFootage==footage
 print('ACTUAL LIVE-RECORDING IMPORT | Resolve '..resolve:GetVersionString())
 print(name..' | fps='..timeline:GetSetting('timelineFrameRate')..' | start='..timeline:GetStartTimecode()..' | markers='..count)
 print('footage='..actualFootage)
 for _,item in ipairs(expected)do
  local marker=markers[item.frame]
  local match=marker and marker.name==item.name and marker.note==item.note and marker.duration==1 and marker.color=='Green'
  pass=pass and match
  print('frame='..item.frame..' | name='..tostring(marker and marker.name)..' | note='..tostring(marker and marker.note)..' | duration='..tostring(marker and marker.duration)..' | color='..tostring(marker and marker.color)..' | '..(match and 'PASS' or 'FAIL'))
 end
 print(pass and 'ACTUAL LIVE-RECORDING IMPORT PASS' or 'ACTUAL LIVE-RECORDING IMPORT FAIL')
else print("Set sd_action='prepare' or 'verify'") end
assert(manager:SaveProject())
