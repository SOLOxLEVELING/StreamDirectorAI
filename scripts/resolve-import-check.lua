-- Run in Resolve's built-in Lua console, in the isolated checkpoint test project.
-- sd_action = "prepare" creates footage-backed timelines. Import via Resolve's UI, then use "verify".
local root = "/Users/adnan/Developer/Hack/Projects/StreamDirectorAI /"
local evidence = root .. "evidence/checkpoint-2/resolve/"
local project = resolve:GetProjectManager():GetCurrentProject()
assert(project:GetName() == "StreamDirector Checkpoint 2 Markers", "Use only the isolated checkpoint project")
local pool = project:GetMediaPool()
local cases = {
  {fps=30, label="zero", start="00:00:00:00", frames={0,15,91,300}},
  {fps=30, label="one-hour", start="01:00:00:00", frames={0,15,91,300}},
  {fps=60, label="zero", start="00:00:00:00", frames={0,30,181,600}},
  {fps=60, label="one-hour", start="01:00:00:00", frames={0,30,181,600}},
}
local names = {"First Frame", "Half Second", "Frame Boundary", "Final Marker"}
local function timelineByName(name)
  for i=1,project:GetTimelineCount() do
    local t = project:GetTimelineByIndex(i)
    if t:GetName() == name then return t end
  end
end
if sd_action == "prepare" then
  for _,case in ipairs(cases) do
    local name = "SD Import " .. case.fps .. " " .. case.label
    local timeline = timelineByName(name)
    if not timeline then
      timeline = assert(pool:CreateEmptyTimeline(name))
    end
    local existing = timeline:GetItemListInTrack("video", 1)
    if not existing or #existing == 0 then
      assert(timeline:SetSettings({useCustomSettings="1"}))
      assert(timeline:SetSettings({timelineFrameRate=tostring(case.fps)}))
      assert(timeline:SetStartTimecode(case.start))
      local media = pool:ImportMedia({root .. "output/test-" .. case.fps .. ".mov"})
      assert(media and media[1], "Test footage import failed")
      assert(project:SetCurrentTimeline(timeline))
      local clips = pool:AppendToTimeline({{mediaPoolItem=media[1]}})
      assert(clips and clips[1], "No test footage on timeline")
    end
    print("PREPARED", name, "fps", timeline:GetSetting("timelineFrameRate"), "start", timeline:GetStartTimecode())
    print("PREPARED " .. name .. " fps=" .. timeline:GetSetting("timelineFrameRate") .. " start=" .. timeline:GetStartTimecode() .. " clips=" .. #timeline:GetItemListInTrack("video", 1))
  end
  print("Import generated-<fps>-<label>.edl into its matching timeline via Media Pool > Timelines > Import > Timeline Markers from EDL.")
  assert(resolve:GetProjectManager():SaveProject())
  print("Then run: sd_action='verify'; dofile([[" .. root .. "scripts/resolve-import-check.lua]])")
elseif sd_action == "verify" then
  local failures = 0
  print("ACTUAL RESOLVE API INSPECTION after UI marker import | Version: " .. resolve:GetVersionString())
  for _,case in ipairs(cases) do
    local name = "SD Import " .. case.fps .. " " .. case.label
    local timeline = assert(timelineByName(name), "Prepare timelines first")
    local markers = timeline:GetMarkers()
    local count = 0; for _ in pairs(markers) do count=count+1 end
    local pass = count == 4 and timeline:GetStartTimecode() == case.start and tonumber(timeline:GetSetting("timelineFrameRate")) == case.fps
    local clips = timeline:GetItemListInTrack("video", 1)
    pass = pass and clips and #clips > 0
    local media = clips and clips[1] and clips[1]:GetMediaPoolItem()
    local footagePath = media and media:GetClipProperty("File Path") or ""
    pass = pass and footagePath == root .. "output/test-" .. case.fps .. ".mov"
    print(name .. " | fps=" .. timeline:GetSetting("timelineFrameRate") .. " | start=" .. timeline:GetStartTimecode() .. " | markers=" .. count)
    print("footage=" .. footagePath)
    for i,frame in ipairs(case.frames) do
      local marker = markers[frame]
      local signal = i == 1 and "chat" or "manual"
      local note = signal .. ": Known fixture " .. i .. " [native-test-" .. (i-1) .. "]"
      local color = i == 1 and "Blue" or "Green"
      local match = marker and marker.name == names[i] and marker.note == note and marker.duration == 1 and marker.color == color
      pass = pass and match
      print("frame=" .. frame .. " | name=" .. tostring(marker and marker.name) .. " | note=" .. tostring(marker and marker.note) .. " | duration=" .. tostring(marker and marker.duration) .. " | color=" .. tostring(marker and marker.color) .. " | " .. (match and "PASS" or "FAIL"))
    end
    print(pass and "CASE PASS" or "CASE FAIL")
    if not pass then failures=failures+1 end
  end
  print("ACTUAL IMPORT CHECK: failed cases", failures)
  assert(resolve:GetProjectManager():SaveProject())
else print("Set sd_action='prepare' or sd_action='verify' before running this file") end
