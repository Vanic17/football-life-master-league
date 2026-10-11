Master League for eFootball — by RBs GameLab & Tom Gibbons
==========================================================
Freeware. Do not re-upload or redistribute; to share it, post the link to the official
evoweb thread (see the license on the About page). Only download from the official thread:
copies found elsewhere may have been tampered with.
Co-author Tom Gibbons: many of the ideas and changes came from his files and articles.

eFootball has no Master League, so this program is one. Fixtures, standings, transfers,
player growth, honours and match reports all live here; the game is only used to play
the matches. Teams, players, badges and faces are read from the game on your own PC.
No internet connection, nothing extra to download. Click "EN" in the top bar to switch
the interface to English.


0. Recommended: MODY 99
--------------------------------------------
The best experience is with the MODY 99 mod (more complete teams, players, badges and
stadiums). MODY 99 is not included; install it yourself following its author's
instructions, then start your career.
- It also works on the official game data, but with fewer teams and players, and the
  numbers were not tuned on it.
- When you start a career, the program copies the game's current player database into
  the save (saves\base\). That career only ever uses that copy. So install MODY 99 first,
  then start the career; changing mods or game updates later won't affect it.


1. Getting started
--------------------------------------------
1. The whole program is one file, "Master League 1.1.exe". Give it a folder of its
   own: your saves are stored in a saves folder next to the exe.
2. Double-click it. Every start unpacks the program and reads the game data, which takes
   a few seconds. If Windows says "Windows protected your PC", click "More info" ->
   "Run anyway" (the program is not code-signed). If your antivirus blocks it, allow it.
3. Install the match-stats plugin: quit the game completely, then click "Plugin" at the
   top -> "Install plugin" (once; updates are installed from the same page).
4. Start a career: pick one of the game's leagues, or search and add teams yourself;
   click "Manage" next to your team, then "Start season".
5. Every time you play: open Master League first, then the game. The "Go to game"
   button does this for you (it starts eFootball through Steam if it isn't running).
   The game loads your career's data when it starts; if you start it the other way
   round you'll see the original squads, just restart the game.


2. Playing
--------------------------------------------
- "Next match" on the home screen shows your opponent and who is at home.
- In eFootball, play a Friendly Match with those two teams. When it ends, choose
  "End match" and go back to the main menu. About 5 seconds later the program records
  the score and every player's stats, simulates the rest of the round and writes the report.
- Changes in your career are written into the game automatically: transfers, youngsters,
  growth, injured/suspended players dropped, card changes, editor changes. While the game
  is running they take effect within seconds.
- You don't have to play every match: use "Simulate", or "Manual" to enter a score.
- When the season is over, click "End season…": renew contracts, release players,
  see the awards, then move on to the next season.
- Closing the window quits the program (while the game is running it waits in the
  background for the match result, then quits).


3. Controller
--------------------------------------------
- The window works with a controller: D-pad to move, A / Cross to confirm,
  B / Circle to go back, LB / RB to switch sections.
- Xbox controller: hold the Xbox button for half a second to switch between the game
  and Master League. First turn off Windows Settings -> Gaming -> Xbox Game Bar ->
  "Open Xbox Game Bar using this button on a controller", or the Game Bar pops up.
  With the plugin installed, the game ignores the controller while it is in the background.


4. Game not found?
--------------------------------------------
The program looks for eFootball in all your Steam libraries. If it can't find it,
create game_dir.txt next to the exe with one line, the game folder, for example
    D:\SteamLibrary\steamapps\common\eFootball
(Steam -> right-click eFootball -> Manage -> Browse local files), then restart the program.


5. Does it change my game files?
--------------------------------------------
- The game's own player database (cpk\dt200_console_all.cpk) is only read, never changed.
- Career changes go into a copy: when the game starts, the plugin copies your career's
  database to cpk\dt200_console_all.ml.cpk and the game reads that copy. Remove the
  plugin and the game is back to normal.
- The program writes two small files in the game folder: mlshadow.src (tells the plugin
  where the career's database is) and mlreload.now / mlreload.done (asks the game to
  reload its data; deleted afterwards).
- "Install plugin" puts dxgi.dll into eFootball\Binaries\Win64\ and three empty switch
  files (statshook.on, attrhook.on, mlshadow.on) both in the game folder and in Win64.
  If another dxgi.dll (another mod) is already there, it is renamed dxgi.dll.ml-backup
  and put back when you remove the plugin.
- "Remove plugin" takes all of that away, plus the database copy, and the game is back to
  normal. The match records in the ml_stats folder are kept; delete them if you like.
- If the game folder can't be written (protected location), right-click the Master League exe ->
  "Run as administrator" and install again.
- After a big game update, if matches stop being recorded, the plugin needs an update:
  get the new version of the program from the official evoweb thread, then
  "Plugin" -> "Update plugin".


6. Plugin risk
--------------------------------------------
The plugin is a dxgi.dll that the game loads into its own process, where it reads match
data and makes the game read your career's database copy. eFootball is an online game and
we cannot promise Konami won't treat this kind of plugin as cheating.
Use it offline / single-player only. Your decision, your responsibility.


7. Where things are
--------------------------------------------
- saves\   your careers (copy this folder when moving to another PC) and the log server.log.
           saves\base\ holds the player databases copied when careers were started
           (15-20 MB each). They are game data: don't share them.
- cache\   badges and faces extracted from the game; rebuilt automatically if deleted.
(Both next to the exe.) Problems? Post in the official evoweb thread and attach saves\server.log.


8. License and disclaimer
--------------------------------------------
All of this is under About -> Guide & licenses in the program:
- the license and disclaimer (English and Chinese);
- the third-party notices and the license texts of the bundled components.
Not affiliated with or endorsed by Konami. Contains no game files, artwork or databases.
Offline / single-player only. Some features write game data and the plugin is loaded by
the game; online this may be treated as cheating. Use at your own risk; back up first.
