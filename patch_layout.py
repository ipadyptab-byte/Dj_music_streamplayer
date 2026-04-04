with open("gui_player.py", "r", encoding="utf-8") as f:
    code = f.read()

# 1. Make the logo even smaller to save top space
code = code.replace(
    "while w // scale_factor > 400 or h // scale_factor > 100:",
    "while w // scale_factor > 250 or h // scale_factor > 60:"
)

# 2. Put Advertisement and Prayer frames side-by-side to save huge amounts of vertical space
old_ad_frame = """        # --- Advertisement section ---
        ad_frame = tk.LabelFrame(left_frame, text="Advertisement Settings", padx=10, pady=10)
        ad_frame.pack(fill="x", padx=10, pady=5)"""

new_ad_frame = """        # Container for bottom settings to save vertical space
        bottom_settings_frame = tk.Frame(left_frame)
        bottom_settings_frame.pack(fill="both", expand=True, padx=5, pady=0)

        # --- Advertisement section ---
        ad_frame = tk.LabelFrame(bottom_settings_frame, text="Advertisement Settings", padx=10, pady=10)
        ad_frame.pack(side="left", fill="both", expand=True, padx=5, pady=5)"""

code = code.replace(old_ad_frame, new_ad_frame)

old_prayer_frame = """        # --- Prayer section ---
        prayer_frame = tk.LabelFrame(left_frame, text="Prayer Settings", padx=10, pady=10)
        prayer_frame.pack(fill="x", padx=10, pady=5)"""

new_prayer_frame = """        # --- Prayer section ---
        prayer_frame = tk.LabelFrame(bottom_settings_frame, text="Prayer Settings", padx=10, pady=10)
        prayer_frame.pack(side="right", fill="both", expand=True, padx=5, pady=5)"""

code = code.replace(old_prayer_frame, new_prayer_frame)

# 3. Shrink listboxes slightly so they don't force the window to be super tall
code = code.replace("self.search_results_listbox = tk.Listbox(results_frame, height=6)", 
                    "self.search_results_listbox = tk.Listbox(results_frame, height=4)")

code = code.replace("self.times_listbox = tk.Listbox(times_frame, height=5)", 
                    "self.times_listbox = tk.Listbox(times_frame, height=3)")

code = code.replace('self.log_text = tk.Text(log_frame, height=20, state="disabled")',
                    'self.log_text = tk.Text(log_frame, height=15, state="disabled")')

with open("gui_player.py", "w", encoding="utf-8") as f:
    f.write(code)

print("Layout patched.")
