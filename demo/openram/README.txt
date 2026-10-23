Cells from OpenRAM (https://github.com/VLSIDA/OpenRAM, branch stable at b2b069ce119d),
technology/scn4m_subm, under OpenRAM's BSD 3-Clause licence (LICENSE in this folder):

  SCN4M_SUBM.20.tech       Magic technology file (tech/), unchanged
  dff.mag, sense_amp.mag, tri_gate.mag, cell_1rw.mag
                           layouts (mag_lib/), changed here: the labels that are the
                           schematic's pins are now ports, numbered in the schematic's
                           order, so that LVS can match pins
  dff.sp, sense_amp.sp, tri_gate.sp, cell_1rw.sp
                           schematics (sp_lib/), unchanged
  setup.tcl                OpenRAM's netgen setup (tech/), unchanged

dff.cmd, an IRSIM command file for the flip-flop, was written for the web app.
"lvs" compares each cell with its schematic (all four match); "irsim
tsmc35.20.n98t.3.3 dff" then "@ dff.cmd" simulates the flip-flop.
