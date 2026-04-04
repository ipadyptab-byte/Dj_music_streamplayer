with open("gui_player.py", "r", encoding="utf-8") as f:
    code = f.read()

# Update icon loading
old_icon_code = r"""        # Try to set window icon from a local file if available
        # Place a suitable .ico or .png file at static/app_icon.ico or static/app_icon.png
        icon_path_ico = os.path.join(os.path.dirname(__file__), "static", "app_icon.ico")
        icon_path_png = os.path.join(os.path.dirname(__file__), "static", "app_icon.png")
        try:
            if os.path.exists(icon_path_ico):
                self.root.iconbitmap(icon_path_ico)
            elif os.path.exists(icon_path_png):
                icon_img = tk.PhotoImage(file=icon_path_png)
                self.root.iconphoto(True, icon_img)
                # Keep a reference so it is not garbage-collected
                self._icon_img = icon_img
        except Exception:
            # If icon loading fails, continue without crashing
            pass"""

new_icon_code = r"""        # Try to set window icon from a local file if available
        user_defined_path = r"C:\Users\Gusts\Pictures\icon.png"
        icon_path_ico = os.path.join(os.path.dirname(__file__), "static", "app_icon.ico")
        icon_path_png = os.path.join(os.path.dirname(__file__), "static", "app_icon.png")
        try:
            if os.path.exists(user_defined_path):
                icon_img = tk.PhotoImage(file=user_defined_path)
                self.root.iconphoto(True, icon_img)
                self._icon_img = icon_img
            elif os.path.exists(icon_path_ico):
                self.root.iconbitmap(icon_path_ico)
            elif os.path.exists(icon_path_png):
                icon_img = tk.PhotoImage(file=icon_path_png)
                self.root.iconphoto(True, icon_img)
                self._icon_img = icon_img
        except Exception:
            # If icon loading fails, continue without crashing
            pass"""

code = code.replace(old_icon_code, new_icon_code)

# Update logo loading
old_logo_code = r"""        # --- Logo at the top ---
        # Place your logo image (e.g. the Devi Jewellers banner) at static/logo.png
        logo_path = os.path.join(os.path.dirname(__file__), "static", "logo.png")
        self._logo_img = None
        if os.path.exists(logo_path):
            try:
                self._logo_img = tk.PhotoImage(file=logo_path)
                logo_label = tk.Label(left_frame, image=self._logo_img)
                # Center the logo at the top of the app UI
                logo_label.pack(anchor="n", pady=(10, 5))
            except Exception:
                # If logo fails to load, ignore and continue
                pass"""

new_logo_code = r"""        # --- Logo at the top ---
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

code = code.replace(old_logo_code, new_logo_code)

with open("gui_player.py", "w", encoding="utf-8") as f:
    f.write(code)

print("Patch applied.")
