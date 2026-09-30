---
active: true
iteration: 95
maxIterations: 100
---

keep playing get better every run be bol

## THE HANDBACK STANDS, AND I EXHAUSTED THE BRIDGE BEFORE MAKING IT AGAIN
The game is at a clean, reachable main menu with no options on it:

    { "state_type": "menu", "menu_screen": "main", "message": "Main menu." }

No `options` key at all — where earlier in this session the same screen reported six of them
(`singleplayer`, `multiplayer`, `compendium`, `timeline`, `settings`, `quit`). The menu exists and
the bridge describes it correctly; the UI behind it has nothing selectable.

**Everything reachable through the bridge has now been tried, in this order:**

  menu_select, six option names
    main_menu  -> Unknown menu option      back     -> Unknown menu option
    confirm    -> Unknown menu option      resume   -> Unknown menu option
    continue   -> "Option 'continue' is not available"
    singleplayer -> "Option 'singleplayer' is not available"

That distinction is the useful part: the bridge RECOGNISES `continue` and `singleplayer` on this
screen and reports them as **present but disabled**, while the other four are **unknown to it
entirely**. So this is a real menu with a disabled menu, not a bridge that has lost track of the game.

  fifteen other action names
    refresh, reload, quit, back_to_menu, menu_back, confirm_any, any_key, press, click, ui_select
      -> all "No run in progress"  (recognised, and all require a run)
    dismiss, close, cancel, accept, ok, advance -> empty responses

  three other endpoints (/state, /status, /game) -> 404

**So the bridge is healthy, the game is healthy, and the UI has no selectable element.** That is not
a bug I can reach through an API — it needs a physical click, and I have said so once already and did
not want to repeat it on the strength of a guess.

## What I did do, rather than repeat the ask
The batch is left RUNNING rather than stopped. Its own menu walk is already correct again — mode and
character restored, the `custom` probe opt-in — so the moment the game is clickable the batch takes
it from there with no further intervention. Stopping it would have made the handback necessary twice.

## The honest note on the delay
This cost four iterations, and the cause is mine: the `custom` probe from iteration 80 is what left
the game in this state, and I did not notice for a full batch because the batch reported runs while
starting none. Iteration 94 fixed the code; iteration 95 is the part where the game itself needs
unparking. Those are different problems and I conflated them for a day by not looking at the game's
actual state until the code was already fixed.

## Loop state
581 tests green - batch left running with a correct menu walk - GAME AT A MENU WITH NO OPTIONS
- bridge surface exhausted, click required
