with open("gui_player.py", "r", encoding="utf-8") as f:
    code = f.read()

old_icon_code = r"""        user_defined_path = r"C:\Users\Gusts\Pictures\icon.png"
        icon_path_ico = os.path.join(os.path.dirname(__file__), "static", "app_icon.ico")"""

new_icon_code = r"""        user_defined_path = r"C:\Users\Gusts\Pictures\Devi J logo png file.png"
        icon_path_ico = os.path.join(os.path.dirname(__file__), "static", "app_icon.ico")"""

code = code.replace(old_icon_code, new_icon_code)

old_logo_code = r"""        # --- Logo at the top ---
        logo_path = os.path.join(os.path.dirname(__file__), "static", "logo.png")
        self._logo_img = None
        
        # Try user-requested absolute path first, fallback to static/logo.png
        target_logo = r"C:\Users\Gusts\Pictures\icon.png" if os.path.exists(r"C:\Users\Gusts\Pictures\icon.png") else logo_path
        
        if os.path.exists(target_logo):
            try:
                self._logo_img = tk.PhotoImage(file=target_logo)
                logo_label = tk.Label(left_frame, image=self._logo_img)
                # Center the logo at the top of the app UI
                logo_label.pack(anchor="n", pady=(10, 5))
            except Exception:
                pass"""

new_logo_code = r"""        # --- Logo at the top ---
        logo_path = os.path.join(os.path.dirname(__file__), "static", "logo.png")
        self._logo_img = None
        
        # Try user-requested absolute path first, fallback to static/logo.png
        target_logo = r"C:\Users\Gusts\Pictures\Devi J logo png file.png" if os.path.exists(r"C:\Users\Gusts\Pictures\Devi J logo png file.png") else logo_path
        
        if os.path.exists(target_logo):
            try:
                self._logo_img = tk.PhotoImage(file=target_logo)
                
                # Resize image to a suitable size for the top bar (e.g. max height ~100px, max width ~400px)
                # Tkinter's PhotoImage only supports integer subsampling natively.
                w = self._logo_img.width()
                h = self._logo_img.height()
                scale_factor = 1
                while w // scale_factor > 400 or h // scale_factor > 100:
                    scale_factor += 1
                
                if scale_factor > 1:
                    self._logo_img = self._logo_img.subsample(scale_factor, scale_factor)

                logo_label = tk.Label(left_frame, image=self._logo_img)
                # Center the logo at the top of the app UI
                logo_label.pack(anchor="n", pady=(10, 5))
            except Exception as e:
                print(f"[DEBUG] Error loading logo: {e}")
                pass"""

code = code.replace(old_logo_code, new_logo_code)

with open("gui_player.py", "w", encoding="utf-8") as f:
    f.write(code)

print("Patch 2 applied.")
