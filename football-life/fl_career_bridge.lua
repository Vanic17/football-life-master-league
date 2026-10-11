local m = {}
local root = ""
local home, away = 0, 0
local last = ""
local goals = {}
local function capture(ctx)
    local s = match.stats()
    if not s then return end
    local events = {}
    for _,g in ipairs(goals) do
        events[#events+1] = string.format('{"pid":%d,"away":%d,"minute":%d}',g.pid,g.away,g.minute)
    end
    local data = string.format('{"home":%d,"away":%d,"home_score":%d,"away_score":%d,"pk_home":%d,"pk_away":%d,"period":%d,"minute":%d,"second":%d,"score_ptr":"%s","goals":[%s],"detail_complete":false}',
        home, away, s.home_score or 0, s.away_score or 0, s.pk_home_score or 0, s.pk_away_score or 0, s.period or 0, s.clock_minutes or 0, s.clock_seconds or 0, tostring(s.ptr),table.concat(events,','))
    if data == last then return s end
    -- Sider's sandbox does not expose os.remove/os.rename.
    local f = io.open(root .. "sider-live.json", "w")
    if not f then return end
    f:write(data); f:close()
    last = data
    return s
end
function m.set_teams(ctx, h, a)
    if h~=home or a~=away then goals={} end
    home, away = h, a
    last = ""
end
function m.goal(ctx, event)
    local s=match.stats()
    goals[#goals+1]={pid=event.player_id,away=event.home_or_away,minute=s and s.clock_minutes or 0}
    last=""
    capture(ctx)
end
function m.set_match_settings(ctx, options)
    local f=io.open(root .. "match-settings.lua", "r")
    if not f then return end
    local text=f:read("*a");f:close()
    -- Parse only the four numeric fields written by the local launcher.
    local h,a,et,pk=text:match("home=(%d+),away=(%d+),extra_time=(%d+),penalties=(%d+)")
    if tonumber(h)~=home or tonumber(a)~=away then return end
    options.extra_time=tonumber(et)
    options.penalties=tonumber(pk)
    return options
end
function m.overlay(ctx)
    local s = capture(ctx)
    if not s then return "Master League / Football Life 26: in attesa di una partita. Conferma il risultato nella carriera dopo il fischio finale." end
    return string.format("Master League / Football Life 26: %d - %d, minuto %d. Conferma nella carriera soltanto dopo il fischio finale.",
        s.home_score or 0, s.away_score or 0, s.clock_minutes or 0)
end
function m.init(ctx)
    root = ctx.sider_dir .. "..\\"
    ctx.register("set_teams", m.set_teams)
    ctx.register("goal_scored", m.goal)
    ctx.register("set_match_settings", m.set_match_settings)
    -- Capture independently of which overlay module is selected or visible.
    ctx.register("display_frame", capture)
    ctx.register("overlay_on", m.overlay)
end
return m
