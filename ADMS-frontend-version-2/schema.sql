CREATE DATABASE IF NOT EXISTS tailstrail_dbms;
USE tailstrail_dbms;

CREATE TABLE IF NOT EXISTS owners (
    owner_id INT AUTO_INCREMENT PRIMARY KEY,
    owner_name VARCHAR(100) NOT NULL,
    email VARCHAR(100) UNIQUE NOT NULL,
    password VARCHAR(255) NOT NULL,
    phone VARCHAR(30),
    address VARCHAR(200)
);

CREATE TABLE IF NOT EXISTS pets (
    pet_id INT AUTO_INCREMENT PRIMARY KEY,
    owner_id INT NOT NULL,
    pet_name VARCHAR(50) NOT NULL,
    birth_date DATE,
    gender ENUM('Male', 'Female') NOT NULL,
    is_spayed_neutered BOOLEAN,
    special_description TEXT,
    CONSTRAINT fk_pets_owner FOREIGN KEY (owner_id) REFERENCES owners(owner_id)
);

CREATE TABLE IF NOT EXISTS medical_records (
    record_id INT AUTO_INCREMENT PRIMARY KEY,
    pet_id INT NOT NULL,
    visit_date DATE NOT NULL,
    diagnosis TEXT,
    meds_used TEXT,
    cure TEXT,
    allergy_trigger VARCHAR(100),
    medical_history TEXT,
    prescription_text TEXT,
    prescription_image_path VARCHAR(255),
    CONSTRAINT fk_medical_pet FOREIGN KEY (pet_id) REFERENCES pets(pet_id)
);

CREATE TABLE IF NOT EXISTS vaccination_records (
    vaccination_id INT AUTO_INCREMENT PRIMARY KEY,
    pet_id INT NOT NULL,
    vaccine_name VARCHAR(50) NOT NULL,
    vaccination_date DATE NOT NULL,
    next_due_date DATE,
    CONSTRAINT fk_vaccination_pet FOREIGN KEY (pet_id) REFERENCES pets(pet_id)
);

CREATE TABLE IF NOT EXISTS deworming_records (
    deworming_id INT AUTO_INCREMENT PRIMARY KEY,
    pet_id INT NOT NULL,
    medicine_name VARCHAR(50),
    deworming_date DATE NOT NULL,
    next_due_date DATE,
    CONSTRAINT fk_deworming_pet FOREIGN KEY (pet_id) REFERENCES pets(pet_id)
);

CREATE TABLE IF NOT EXISTS care_records (
    care_id INT AUTO_INCREMENT PRIMARY KEY,
    pet_id INT NOT NULL,
    care_type TEXT NOT NULL,
    care_date DATE NOT NULL,
    notes TEXT,
    CONSTRAINT fk_care_pet FOREIGN KEY (pet_id) REFERENCES pets(pet_id)
);

CREATE TABLE IF NOT EXISTS weight_records (
    weight_id INT AUTO_INCREMENT PRIMARY KEY,
    pet_id INT NOT NULL,
    weight_kg DECIMAL(5,2) NOT NULL,
    record_date DATE NOT NULL,
    CONSTRAINT fk_weight_pet FOREIGN KEY (pet_id) REFERENCES pets(pet_id)
);

CREATE TABLE IF NOT EXISTS pet_transfer_records (
    transfer_id INT AUTO_INCREMENT PRIMARY KEY,
    pet_id INT NOT NULL,
    old_owner_id INT NOT NULL,
    new_owner_id INT NOT NULL,
    transfer_date DATE NOT NULL,
    notes TEXT,
    CONSTRAINT fk_transfer_pet FOREIGN KEY (pet_id) REFERENCES pets(pet_id),
    CONSTRAINT fk_transfer_old_owner FOREIGN KEY (old_owner_id) REFERENCES owners(owner_id),
    CONSTRAINT fk_transfer_new_owner FOREIGN KEY (new_owner_id) REFERENCES owners(owner_id)
);

DROP TRIGGER IF EXISTS trg_set_transfer_date;
DELIMITER $$
CREATE TRIGGER trg_set_transfer_date
BEFORE INSERT ON pet_transfer_records
FOR EACH ROW
BEGIN
    IF NEW.transfer_date IS NULL THEN
        SET NEW.transfer_date = CURDATE();
    END IF;
END$$
DELIMITER ;

DROP TRIGGER IF EXISTS trg_update_pet_owner;
DELIMITER $$
CREATE TRIGGER trg_update_pet_owner
AFTER INSERT ON pet_transfer_records
FOR EACH ROW
BEGIN
    UPDATE pets
    SET owner_id = NEW.new_owner_id
    WHERE pet_id = NEW.pet_id;
END$$
DELIMITER ;

DROP TRIGGER IF EXISTS trg_prevent_duplicate_vaccination;
DELIMITER $$
CREATE TRIGGER trg_prevent_duplicate_vaccination
BEFORE INSERT ON vaccination_records
FOR EACH ROW
BEGIN
    IF EXISTS (
        SELECT 1 FROM vaccination_records
        WHERE pet_id = NEW.pet_id
          AND vaccine_name = NEW.vaccine_name
          AND vaccination_date = NEW.vaccination_date
    ) THEN
        SIGNAL SQLSTATE '45000'
        SET MESSAGE_TEXT = 'Duplicate vaccination record not allowed';
    END IF;
END$$
DELIMITER ;

DROP TRIGGER IF EXISTS trg_check_deworming_due;
DELIMITER $$
CREATE TRIGGER trg_check_deworming_due
BEFORE INSERT ON deworming_records
FOR EACH ROW
BEGIN
    IF NEW.next_due_date IS NOT NULL AND NEW.next_due_date < CURDATE() THEN
        SET NEW.next_due_date = DATE_ADD(CURDATE(), INTERVAL 6 MONTH);
    END IF;
END$$
DELIMITER ;
